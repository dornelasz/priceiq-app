/**
 * catalogProcessingOrchestrator — processa candidatos salvos do catálogo,
 * raspando product_urls e criando matches (Etapa 16).
 *
 * Fluxo:
 *   1. listCandidatesByQuery (ou filtra por candidateIds)
 *   2. limita por maxCandidates
 *   3. para cada candidato: processOneCandidate (fetch + extract)
 *   4. updateCandidateExtraction (status + dados)
 *   5. createOrUpdateMatch quando validated/partial (confirmed/pending) ou
 *      product_mismatch (rejected)
 *
 * Sem candidatos → status 'no_candidates' + recomendação de rodar
 * /discover-catalog antes. NUNCA usa IA/Gemini. NUNCA lança.
 */
import { config } from '../../../../config.js';
import {
  supplierProductCatalogService,
  normalizeCatalogQuery,
  type SupplierProductCatalogService,
} from '../../catalog/index.js';
import { resolveProvidersFromConfig } from '../providers/providerResolver.js';
import { createSearchEngineContext } from '../core/searchEngineContext.js';
import { FIRECRAWL_CREDIT_ESTIMATE_PER_CALL } from '../core/searchBudget.js';
import { anyProviderCanFetch } from '../pipeline/providerChain.js';
import { addDiagnosticAttempt } from '../core/searchEngineContext.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { FetchProvider } from '../providers/fetchProvider.js';
import type { SearchBudget } from '../core/searchBudget.js';
import { processOneCandidate } from './catalogCandidateProcessor.js';
import { mapResultToCandidateUpdate } from './catalogProcessingMapper.js';
import type {
  CatalogProcessingInput,
  CatalogProcessingResult,
  CatalogProcessingStatus,
  ProcessedCandidate,
} from './catalogProcessingTypes.js';

const DEFAULT_MAX_CANDIDATES = 5;

export interface CatalogProcessingDeps {
  catalogService?: SupplierProductCatalogService;
  /** Providers de coleta. Default: resolveProvidersFromConfig(). */
  providers?: FetchProvider[];
  config?: typeof config;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function deriveOverallStatus(
  processed: number,
  updated: number,
  errors: number,
): CatalogProcessingStatus {
  if (processed === 0) return 'no_candidates';
  if (errors > 0 && updated === 0) return 'failed';
  if (errors > 0) return 'partial';
  return 'completed';
}

/**
 * Processa candidatos do catálogo para um fornecedor + query.
 */
export async function processCatalogCandidates(
  input: CatalogProcessingInput,
  deps: CatalogProcessingDeps = {},
): Promise<CatalogProcessingResult> {
  const cfg = deps.config ?? config;
  const catalogService = deps.catalogService ?? supplierProductCatalogService;
  const normalizedQuery = normalizeCatalogQuery(input.query);
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minMatchScore = input.minMatchScore ?? cfg.MIN_MATCH_SCORE;
  const trustedScore = cfg.MATCH_SCORE_TRUSTED;

  const resolved = resolveProvidersFromConfig(cfg);
  const providers = deps.providers ?? resolved.providers;
  const policy = { ...resolved.policy, ...input.providerPolicy };
  const firecrawlEnabled = policy.firecrawlEnabled ?? false;

  const budget: Partial<SearchBudget> = {
    maxCandidateUrls: maxCandidates,
    maxFetchesPerSupplier: maxCandidates * 2 + 2,
    maxExtractionAttempts: maxCandidates,
    maxNativeFetches: maxCandidates + 2,
    maxExternalFetches: firecrawlEnabled ? maxCandidates : 0,
    maxFirecrawlCalls: firecrawlEnabled ? maxCandidates : 0,
    maxFirecrawlCreditsEstimated: firecrawlEnabled
      ? maxCandidates * FIRECRAWL_CREDIT_ESTIMATE_PER_CALL
      : 0,
    ...input.budget,
  };

  const context = createSearchEngineContext({
    supplier: input.supplier,
    query: input.query,
    providerPolicy: policy,
    budget,
  });

  const result: CatalogProcessingResult = {
    supplierId: input.supplier.id,
    query: input.query,
    normalizedQuery,
    status: 'no_candidates',
    candidatesProcessed: 0,
    candidatesUpdated: 0,
    matchesCreated: 0,
    matchesRejected: 0,
    statusBreakdown: {},
    processed: [],
    attempts: context.diagnostics.attempts,
    errors: [],
  };

  // ─── 1. Buscar candidatos ───────────────────────────────────────────────
  let candidates;
  try {
    candidates = await catalogService.listCandidatesByQuery(
      input.supplier.id,
      normalizedQuery,
    );
  } catch (e) {
    result.errors.push({ message: (e as Error).message });
    result.status = 'failed';
    return result;
  }

  if (input.candidateIds && input.candidateIds.length > 0) {
    const wanted = new Set(input.candidateIds);
    candidates = candidates.filter((c) => wanted.has(c.id));
  }

  const toProcess = candidates.slice(0, maxCandidates);

  if (toProcess.length === 0) {
    result.status = 'no_candidates';
    result.recommendation =
      'Nenhum candidato no catálogo para esta query. Rode POST /api/suppliers/:id/discover-catalog primeiro.';
    return result;
  }

  // ─── 2. Processar cada candidato ────────────────────────────────────────
  for (const candidate of toProcess) {
    if (!anyProviderCanFetch(providers, context)) {
      addDiagnosticAttempt(
        context,
        makeSearchAttempt({
          step: 'budget',
          status: 'candidate_not_found',
          detail: 'orçamento de coleta esgotado durante o processamento',
        }),
      );
      break;
    }

    result.candidatesProcessed += 1;

    const outcome = await processOneCandidate(
      {
        candidateId: candidate.id,
        productUrl: candidate.productUrl,
        supplier: input.supplier,
        recipe: input.supplier.recipe ?? null,
        query: input.query,
        minMatchScore,
        trustedScore,
        timeoutMs: input.timeoutMs,
      },
      providers,
      context,
    );

    bump(result.statusBreakdown, outcome.processingStatus);

    const entry: ProcessedCandidate = {
      candidateId: candidate.id,
      productUrl: candidate.productUrl,
      status: outcome.processingStatus,
      candidateStatus: null,
      matchScore: outcome.result?.matchScore ?? null,
      matchStatus: null,
      updated: false,
      matchCreated: false,
    };

    // ── Falha de coleta sem extração ──────────────────────────────────────
    if (outcome.fetchFailed) {
      if (outcome.processingStatus === 'blocked') {
        // Registra o bloqueio no candidato (match_score preservado via COALESCE).
        try {
          await catalogService.updateCandidateExtraction({
            candidateId: candidate.id,
            status: 'blocked',
          });
          result.candidatesUpdated += 1;
          entry.updated = true;
          entry.candidateStatus = 'blocked';
        } catch (e) {
          result.errors.push({ candidateId: candidate.id, message: (e as Error).message });
        }
      } else {
        // timeout/error: transitório — não sobrescreve o candidato.
        result.errors.push({
          candidateId: candidate.id,
          message: outcome.errorMessage ?? outcome.processingStatus,
        });
      }
      result.processed.push(entry);
      continue;
    }

    // ── Extração rodou ────────────────────────────────────────────────────
    const { result: extraction, decision } = outcome;
    if (!extraction || !decision) {
      result.processed.push(entry);
      continue;
    }

    entry.candidateStatus = decision.candidateStatus;

    try {
      await catalogService.updateCandidateExtraction(
        mapResultToCandidateUpdate(candidate.id, extraction, decision),
      );
      result.candidatesUpdated += 1;
      entry.updated = true;
    } catch (e) {
      result.errors.push({ candidateId: candidate.id, message: (e as Error).message });
    }

    if (decision.createMatch && decision.matchStatus) {
      try {
        await catalogService.createOrUpdateMatch({
          supplierId: input.supplier.id,
          candidateId: candidate.id,
          queryText: input.query,
          normalizedQuery,
          matchStatus: decision.matchStatus,
          matchScore: extraction.matchScore ?? null,
          confidence: extraction.confidence ?? null,
          reason: decision.reason,
        });
        entry.matchStatus = decision.matchStatus;
        entry.matchCreated = true;
        if (decision.matchStatus === 'rejected') {
          result.matchesRejected += 1;
        } else {
          result.matchesCreated += 1;
        }
      } catch (e) {
        result.errors.push({ candidateId: candidate.id, message: (e as Error).message });
      }
    }

    result.processed.push(entry);
  }

  result.status = deriveOverallStatus(
    result.candidatesProcessed,
    result.candidatesUpdated,
    result.errors.length,
  );

  return result;
}

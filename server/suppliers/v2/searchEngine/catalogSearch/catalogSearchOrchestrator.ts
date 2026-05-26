/**
 * catalogSearchOrchestrator — fluxo catalog-first para busca por fornecedor
 * (Etapa 17).
 *
 * Fluxo principal:
 *   A. normalizeCatalogQuery
 *   B. listReusableMatches → se existirem:
 *        processCatalogCandidates(candidateIds) → strategy='reused_matches'
 *      senão:
 *        runCatalogDiscovery → processCatalogCandidates → strategy='discovered_then_processed'
 *   C. listCandidatesByQuery para obter dados atualizados
 *   D. buildUsefulResults / buildFailures / buildDiagnostics
 *
 * NUNCA usa IA/Gemini. NUNCA lança. NUNCA retorna HTML bruto.
 */
import {
  supplierProductCatalogService,
  normalizeCatalogQuery,
  type SupplierProductCatalogService,
} from '../../catalog/index.js';
import {
  runCatalogDiscovery,
  type CatalogDiscoveryInput,
  type CatalogDiscoveryResult,
} from '../catalogDiscovery/index.js';
import {
  processCatalogCandidates,
  type CatalogProcessingInput,
  type CatalogProcessingResult,
} from '../catalogProcessing/index.js';
import {
  buildUsefulResults,
  buildFailures,
  candidateListToMap,
} from './catalogSearchResultMapper.js';
import { buildDiagnostics } from './catalogSearchDiagnostics.js';
import type {
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSearchStatus,
} from './catalogSearchTypes.js';

export interface CatalogSearchDeps {
  catalogService?: SupplierProductCatalogService;
  runCatalogDiscoveryFn?: (input: CatalogDiscoveryInput) => Promise<CatalogDiscoveryResult>;
  processCatalogCandidatesFn?: (
    input: CatalogProcessingInput,
  ) => Promise<CatalogProcessingResult>;
}

const DEFAULT_MAX_REUSABLE_MATCHES = 5;
const DEFAULT_MAX_DISCOVERY_CANDIDATES = 20;
const DEFAULT_MAX_PROCESSING_CANDIDATES = 5;

function deriveStatus(
  usefulResults: number,
  candidatesProcessed: number,
  errorCount: number,
): CatalogSearchStatus {
  if (usefulResults > 0 && errorCount === 0) return 'completed';
  if (usefulResults > 0) return 'partial';
  if (candidatesProcessed === 0) return 'no_candidates';
  return 'no_matches';
}

/**
 * Executa a busca catalog-first para um fornecedor e query.
 * Retorna resultados úteis (validated/partial com evidência + preço)
 * e falhas controladas. Nunca lança.
 */
export async function runCatalogFirstSupplierSearch(
  input: CatalogSearchInput,
  deps: CatalogSearchDeps = {},
): Promise<CatalogSearchResult> {
  const catalogService = deps.catalogService ?? supplierProductCatalogService;
  const discoverFn = deps.runCatalogDiscoveryFn ?? runCatalogDiscovery;
  const processFn = deps.processCatalogCandidatesFn ?? processCatalogCandidates;

  const normalizedQuery = normalizeCatalogQuery(input.query);
  const maxReusableMatches =
    input.maxReusableMatches ?? DEFAULT_MAX_REUSABLE_MATCHES;
  const maxDiscoveryCandidates =
    input.maxDiscoveryCandidates ?? DEFAULT_MAX_DISCOVERY_CANDIDATES;
  const maxProcessingCandidates =
    input.maxProcessingCandidates ?? DEFAULT_MAX_PROCESSING_CANDIDATES;

  // Ignora maxReusableMatches no resultado — listReusableMatches já
  // retorna todos os confirmed; o limite é informativo para o caller.
  void maxReusableMatches;

  const result: CatalogSearchResult = {
    supplierId: input.supplier.id,
    query: input.query,
    normalizedQuery,
    status: 'no_candidates',
    strategy: null,
    reusedMatchesCount: 0,
    candidatesDiscovered: 0,
    candidatesProcessed: 0,
    matchesCreated: 0,
    usefulResults: [],
    failures: [],
    attempts: [],
    diagnostics: buildDiagnostics(0, null, null),
    errors: [],
  };

  // ─── A. Verificar matches reutilizáveis ────────────────────────────────
  let reusableMatches;
  try {
    reusableMatches = await catalogService.listReusableMatches(
      input.supplier.id,
      normalizedQuery,
    );
  } catch (e) {
    result.errors.push({ message: (e as Error).message });
    result.status = 'failed';
    return result;
  }

  let processingResult: CatalogProcessingResult;
  let discoveryResult: CatalogDiscoveryResult | null = null;

  // ─── B. Path: matches reutilizáveis ────────────────────────────────────
  if (reusableMatches.length > 0) {
    result.reusedMatchesCount = reusableMatches.length;
    result.strategy = 'reused_matches';
    const candidateIds = reusableMatches.map((m) => m.candidateId);

    try {
      processingResult = await processFn({
        supplier: input.supplier,
        query: input.query,
        candidateIds,
        maxCandidates: maxProcessingCandidates,
        minMatchScore: input.minMatchScore,
        providerPolicy: input.providerPolicy,
        budget: input.budget,
        timeoutMs: input.timeoutMs,
      });
    } catch (e) {
      result.errors.push({ message: (e as Error).message });
      result.status = 'failed';
      return result;
    }
  } else {
    // ─── C. Path: discovery + processamento ──────────────────────────────
    result.strategy = 'discovered_then_processed';

    try {
      discoveryResult = await discoverFn({
        supplier: input.supplier,
        query: input.query,
        recipe: input.recipe ?? input.supplier.recipe ?? null,
        maxCandidates: maxDiscoveryCandidates,
        providerPolicy: input.providerPolicy,
        budget: input.budget,
      });
    } catch (e) {
      result.errors.push({ message: (e as Error).message });
      result.status = 'failed';
      return result;
    }

    result.candidatesDiscovered = discoveryResult.candidatesSaved;
    result.attempts = discoveryResult.attempts;

    if (discoveryResult.candidatesSaved === 0) {
      result.status = 'no_candidates';
      result.recommendation =
        'Nenhum candidato encontrado pelo discovery. ' +
        'Verifique a query ou tente POST /api/suppliers/:id/discover-catalog com outras fontes.';
      result.diagnostics = buildDiagnostics(0, discoveryResult, null);
      return result;
    }

    try {
      processingResult = await processFn({
        supplier: input.supplier,
        query: input.query,
        maxCandidates: maxProcessingCandidates,
        minMatchScore: input.minMatchScore,
        providerPolicy: input.providerPolicy,
        budget: input.budget,
        timeoutMs: input.timeoutMs,
      });
    } catch (e) {
      result.errors.push({ message: (e as Error).message });
      result.status = 'failed';
      return result;
    }
  }

  // ─── D. Construir resultados úteis ────────────────────────────────────
  result.candidatesProcessed = processingResult.candidatesProcessed;
  result.matchesCreated = processingResult.matchesCreated;
  result.attempts = [...result.attempts, ...processingResult.attempts];

  for (const e of processingResult.errors) {
    result.errors.push({ message: e.message });
  }

  // Busca candidatos atualizados do banco para obter preço/produto/evidência.
  let updatedCandidates: Awaited<
    ReturnType<typeof catalogService.listCandidatesByQuery>
  >;
  try {
    updatedCandidates = await catalogService.listCandidatesByQuery(
      input.supplier.id,
      normalizedQuery,
    );
  } catch (e) {
    result.errors.push({ message: (e as Error).message });
    updatedCandidates = [];
  }

  const candidatesById = candidateListToMap(updatedCandidates);
  result.usefulResults = buildUsefulResults(processingResult.processed, candidatesById);
  result.failures = buildFailures(processingResult.processed);

  result.diagnostics = buildDiagnostics(
    result.reusedMatchesCount,
    discoveryResult,
    processingResult,
  );

  result.status = deriveStatus(
    result.usefulResults.length,
    result.candidatesProcessed,
    result.errors.length,
  );

  return result;
}

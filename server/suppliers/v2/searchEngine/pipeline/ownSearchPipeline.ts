/**
 * ownSearchPipeline — pipeline próprio executável do motor de busca (Etapa 7).
 *
 * Orquestra, ponta a ponta, uma busca em UM fornecedor usando SOMENTE o motor
 * próprio: SearchEngineContext + ProviderPolicy + SearchBudget + NativeFetcher
 * + ProductUrlDiscovery + localProductExtractor. NÃO usa Firecrawl nem IA
 * (gating permanece desligado por padrão e os stubs nunca são chamados aqui).
 *
 * Fluxo:
 *   1. cria contexto (defaults seguros)
 *   2. monta a search URL (buildDiscoverySearchUrl)
 *   3. fetch da página de busca (NativeFetcher)
 *   4. descobre URLs candidatas (discoverProductUrls)
 *   5. fetch de cada candidato (NativeFetcher), respeitando orçamento
 *   6. extrai com localProductExtractor (Etapa 4)
 *   7. devolve o 1º resultado útil (validated/partial) ou a melhor falha
 *      controlada (blocked/timeout/price_not_found/product_mismatch/not_found/error)
 *
 * Não faz rede própria além do FetchProvider injetado/nativo. NUNCA lança:
 * exceções viram status 'error' controlado.
 */
import type {
  RunOwnSearchPipelineInput,
  OwnSearchPipelineOutcome,
} from './pipelineTypes.js';
import {
  createSearchEngineContext,
  addDiagnosticAttempt,
  type SearchEngineContext,
} from '../core/searchEngineContext.js';
import { hasBudgetRemaining, consumeBudget } from '../core/searchBudget.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import { createNativeFetchProvider } from '../providers/nativeFetcher.js';
import type { FetchProvider } from '../providers/fetchProvider.js';
import { buildDiscoverySearchUrl } from '../discovery/searchUrlBuilder.js';
import { discoverProductUrls } from '../discovery/productUrlDiscovery.js';
import { extractLocalProduct } from '../../extractors/localProductExtractor.js';
import { buildStatusResult } from '../../recipeRunner/resultBuilder.js';
import type { UniversalSearchResult } from '../../types.js';
import {
  mapFetchStatusToResultStatus,
  classifyExtractionForDiagnostics,
} from './pipelineResultMapper.js';

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host.length > 0 && host !== 'localhost' && host.includes('.');
  } catch {
    return false;
  }
}

function finalize(
  context: SearchEngineContext,
  result: UniversalSearchResult,
  candidateUrls: string[],
  startedAt: number,
): OwnSearchPipelineOutcome {
  addDiagnosticAttempt(
    context,
    makeSearchAttempt({
      step: 'finalize',
      status: classifyExtractionForDiagnostics(result),
      detail: `status final: ${result.status}`,
    }),
  );
  return {
    result,
    context,
    candidateUrls,
    attempts: context.diagnostics.attempts,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function runOwnSearchPipeline(
  input: RunOwnSearchPipelineInput,
): Promise<OwnSearchPipelineOutcome> {
  const context = createSearchEngineContext({
    supplier: input.supplier,
    query: input.query,
    searchId: input.searchId,
    recipe: input.recipe,
    budget: input.budget,
    providerPolicy: input.providerPolicy,
  });

  const startedAt = context.startedAt;
  const fetchProvider: FetchProvider =
    input.fetchProvider ?? createNativeFetchProvider();
  const timeoutMs = input.timeoutMs;
  const maxCandidates = input.maxCandidates ?? context.budget.maxCandidateUrls;
  const candidateUrls: string[] = [];

  try {
    // ─── 2. Montar search URL ──────────────────────────────────────────
    const { url: searchUrl, source: urlSource } = buildDiscoverySearchUrl({
      supplier: input.supplier,
      recipe: input.recipe,
      query: input.query,
    });

    if (!searchUrl || !isValidHttpUrl(searchUrl)) {
      addDiagnosticAttempt(
        context,
        makeSearchAttempt({
          step: 'build_search_url',
          status: 'error',
          detail: 'sem URL de busca válida para o fornecedor',
        }),
      );
      return finalize(
        context,
        buildStatusResult(
          'needs_supplier_setup',
          'fornecedor sem template de busca e sem site válido para fallback',
        ),
        candidateUrls,
        startedAt,
      );
    }

    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'build_search_url',
        status: 'candidate_found',
        url: searchUrl,
        detail: `origem: ${urlSource}`,
      }),
    );

    // ─── 3. Fetch da página de busca (NativeFetcher) ───────────────────
    if (
      !hasBudgetRemaining(context, 'nativeFetch') ||
      !hasBudgetRemaining(context, 'fetch') ||
      !hasBudgetRemaining(context, 'elapsed')
    ) {
      return finalize(
        context,
        buildStatusResult('error', 'orçamento esgotado antes da busca'),
        candidateUrls,
        startedAt,
      );
    }
    consumeBudget(context, 'nativeFetch');
    consumeBudget(context, 'fetch');

    const searchRes = await fetchProvider.fetchPage({ url: searchUrl, timeoutMs });

    if (searchRes.status !== 'success' || !searchRes.html) {
      const mapped = mapFetchStatusToResultStatus(
        searchRes.status,
        searchRes.errorMessage,
      );
      addDiagnosticAttempt(
        context,
        makeSearchAttempt({
          step: 'search_fetch',
          status:
            searchRes.status === 'blocked'
              ? 'blocked'
              : searchRes.status === 'timeout'
                ? 'timeout'
                : 'native_fetch_failed',
          url: searchUrl,
          providerName: fetchProvider.name,
          detail: mapped.message,
          elapsedMs: searchRes.elapsedMs,
        }),
      );
      return finalize(
        context,
        buildStatusResult(mapped.status, mapped.message),
        candidateUrls,
        startedAt,
      );
    }

    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'search_fetch',
        status: 'native_fetch_success',
        url: searchUrl,
        providerName: fetchProvider.name,
        elapsedMs: searchRes.elapsedMs,
      }),
    );

    // ─── 4. Descobrir candidatos ───────────────────────────────────────
    const discovery = discoverProductUrls({
      supplier: input.supplier,
      recipe: input.recipe,
      query: input.query,
      searchPageHtml: searchRes.html,
      searchPageUrl: searchRes.finalUrl ?? searchUrl,
      maxCandidates,
    });

    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'discovery',
        status:
          discovery.candidates.length > 0 ? 'candidate_found' : 'candidate_not_found',
        detail: `${discovery.candidates.length} candidatos (extraídos ${discovery.diagnostics.linksExtracted}, rejeitados ${discovery.diagnostics.linksRejected})`,
      }),
    );

    if (discovery.candidates.length === 0) {
      return finalize(
        context,
        buildStatusResult('not_found', 'sem candidatos a produto na página de busca'),
        candidateUrls,
        startedAt,
      );
    }

    // ─── 5+6. Iterar candidatos até achar um resultado útil ────────────
    let bestMismatch: { result: UniversalSearchResult; score: number } | null = null;
    let sawProductWithoutPrice = false;
    let sawCandidateFetched = false;
    let sawBlocked = false;
    let sawTimeout = false;
    let sawError = false;

    for (const candidate of discovery.candidates) {
      // Orçamentos que encerram o laço (não só pulam o candidato)
      if (
        !hasBudgetRemaining(context, 'elapsed') ||
        !hasBudgetRemaining(context, 'candidateUrl') ||
        !hasBudgetRemaining(context, 'nativeFetch') ||
        !hasBudgetRemaining(context, 'fetch')
      ) {
        addDiagnosticAttempt(
          context,
          makeSearchAttempt({
            step: 'budget',
            status: 'candidate_not_found',
            detail: 'orçamento esgotado durante a iteração de candidatos',
          }),
        );
        break;
      }

      consumeBudget(context, 'candidateUrl');
      consumeBudget(context, 'nativeFetch');
      consumeBudget(context, 'fetch');
      candidateUrls.push(candidate.url);

      const prodRes = await fetchProvider.fetchPage({ url: candidate.url, timeoutMs });

      if (prodRes.status === 'blocked') {
        sawBlocked = true;
        addDiagnosticAttempt(
          context,
          makeSearchAttempt({
            step: 'product_fetch',
            status: 'blocked',
            url: candidate.url,
            providerName: fetchProvider.name,
            elapsedMs: prodRes.elapsedMs,
          }),
        );
        continue;
      }
      if (prodRes.status === 'timeout') {
        sawTimeout = true;
        addDiagnosticAttempt(
          context,
          makeSearchAttempt({
            step: 'product_fetch',
            status: 'timeout',
            url: candidate.url,
            providerName: fetchProvider.name,
            elapsedMs: prodRes.elapsedMs,
          }),
        );
        continue;
      }
      if (prodRes.status !== 'success' || !prodRes.html) {
        sawError = true;
        addDiagnosticAttempt(
          context,
          makeSearchAttempt({
            step: 'product_fetch',
            status: 'native_fetch_failed',
            url: candidate.url,
            providerName: fetchProvider.name,
            detail: prodRes.errorMessage,
            elapsedMs: prodRes.elapsedMs,
          }),
        );
        continue;
      }

      sawCandidateFetched = true;
      addDiagnosticAttempt(
        context,
        makeSearchAttempt({
          step: 'product_fetch',
          status: 'native_fetch_success',
          url: candidate.url,
          providerName: fetchProvider.name,
          elapsedMs: prodRes.elapsedMs,
        }),
      );

      if (!hasBudgetRemaining(context, 'extraction')) break;
      consumeBudget(context, 'extraction');

      const productUrl = prodRes.finalUrl ?? candidate.url;
      const local = extractLocalProduct({
        url: productUrl,
        supplier: input.supplier,
        query: input.query,
        html: prodRes.html,
        markdown: prodRes.markdown,
        preferredStrategy: input.recipe?.extractionStrategy,
        minMatchScore: input.minMatchScore,
      });

      const extractionStatus = classifyExtractionForDiagnostics(local);
      addDiagnosticAttempt(
        context,
        makeSearchAttempt({
          step: 'extraction',
          status: extractionStatus,
          url: productUrl,
          detail: local.errorMessage ?? `status: ${local.status}`,
        }),
      );

      if (local.status === 'validated') {
        return finalize(context, local, candidateUrls, startedAt);
      }
      if (local.status === 'product_mismatch') {
        const score = local.matchScore ?? 0;
        if (!bestMismatch || score > bestMismatch.score) {
          bestMismatch = { result: local, score };
        }
        continue;
      }
      if (local.status === 'price_not_found') {
        sawProductWithoutPrice = true;
        continue;
      }
      // invalid_link / not_found → próximo candidato
    }

    // ─── 7. Nenhum candidato virou útil → melhor falha controlada ──────
    if (!sawCandidateFetched) {
      if (sawBlocked) {
        return finalize(
          context,
          buildStatusResult('blocked', 'todos os candidatos foram bloqueados'),
          candidateUrls,
          startedAt,
        );
      }
      if (sawTimeout) {
        return finalize(
          context,
          buildStatusResult('timeout', 'todos os candidatos excederam o tempo'),
          candidateUrls,
          startedAt,
        );
      }
      if (sawError) {
        return finalize(
          context,
          buildStatusResult('error', 'falha técnica ao coletar os candidatos'),
          candidateUrls,
          startedAt,
        );
      }
      return finalize(
        context,
        buildStatusResult('not_found', 'nenhum candidato pôde ser coletado'),
        candidateUrls,
        startedAt,
      );
    }

    if (sawProductWithoutPrice) {
      return finalize(
        context,
        buildStatusResult(
          'price_not_found',
          'produto encontrado em candidato, mas preço/moeda não foram extraídos',
        ),
        candidateUrls,
        startedAt,
      );
    }
    if (bestMismatch) {
      return finalize(context, bestMismatch.result, candidateUrls, startedAt);
    }
    return finalize(
      context,
      buildStatusResult(
        'not_found',
        'candidatos coletados mas nenhum se confirmou como produto compatível',
      ),
      candidateUrls,
      startedAt,
    );
  } catch (e) {
    const msg = (e as Error).message ?? 'erro inesperado no pipeline próprio';
    const isTimeout = /timeout|tempo esgotado|abort/i.test(msg);
    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'error',
        status: isTimeout ? 'timeout' : 'error',
        detail: msg,
      }),
    );
    return finalize(
      context,
      buildStatusResult(isTimeout ? 'timeout' : 'error', msg),
      candidateUrls,
      startedAt,
    );
  }
}

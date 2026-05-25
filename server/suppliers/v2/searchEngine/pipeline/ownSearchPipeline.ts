/**
 * ownSearchPipeline — pipeline próprio executável do motor de busca.
 *
 * Orquestra, ponta a ponta, uma busca em UM fornecedor. O PriceIQ é o motor:
 * SearchEngineContext + ProviderPolicy + SearchBudget + cadeia de FetchProviders
 * + ProductUrlDiscovery + localProductExtractor.
 *
 * Coleta de páginas (Etapa 11): uma cadeia ordenada de providers com fallback.
 *   - Firecrawl ligado  → ordem [firecrawl, native]: Firecrawl primeiro
 *     (o site bloqueia o fetch direto), NativeFetcher como fallback.
 *   - Firecrawl desligado → só o NativeFetcher (comportamento da Etapa 7).
 * O primeiro provider que devolve success com HTML vence. Links que o provider
 * já trouxe (Firecrawl formats:["links"]) entram no discovery próprio.
 *
 * A extração/validação de preço continua 100% no localProductExtractor — o
 * Firecrawl NUNCA decide preço, frete ou link.
 *
 * NUNCA lança: exceções viram status 'error' controlado.
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
import {
  fetchThroughProviders,
  anyProviderCanFetch,
} from './providerChain.js';

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

function resolveProviders(input: RunOwnSearchPipelineInput): FetchProvider[] {
  if (input.fetchProviders && input.fetchProviders.length > 0) {
    return input.fetchProviders;
  }
  if (input.fetchProvider) return [input.fetchProvider];
  return [createNativeFetchProvider()];
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
  const providers = resolveProviders(input);
  const providerPriority = providers.map((p) => p.type);
  const firecrawlEnabled = context.providerPolicy.firecrawlEnabled;
  const timeoutMs = input.timeoutMs;
  const maxCandidates = input.maxCandidates ?? context.budget.maxCandidateUrls;
  const candidateUrls: string[] = [];
  let usedFallbackAny = false;

  function finalize(result: UniversalSearchResult): OwnSearchPipelineOutcome {
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
      providerPriority,
      firecrawlEnabled,
      usedFallback: usedFallbackAny,
    };
  }

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
        buildStatusResult(
          'needs_supplier_setup',
          'fornecedor sem template de busca e sem site válido para fallback',
        ),
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

    // ─── 3. Coleta da página de busca (cadeia de providers) ────────────
    if (
      !anyProviderCanFetch(providers, context) ||
      !hasBudgetRemaining(context, 'elapsed')
    ) {
      return finalize(buildStatusResult('error', 'orçamento esgotado antes da busca'));
    }

    const searchChain = await fetchThroughProviders(
      providers,
      { url: searchUrl, timeoutMs },
      context,
      'search_fetch',
    );
    if (searchChain.usedFallback) usedFallbackAny = true;
    const searchRes = searchChain.result;

    if (searchRes.status !== 'success' || !searchRes.html) {
      const mapped = mapFetchStatusToResultStatus(
        searchRes.status,
        searchRes.errorMessage,
      );
      return finalize(buildStatusResult(mapped.status, mapped.message));
    }

    // ─── 4. Descobrir candidatos (HTML + links do provider) ────────────
    const discovery = discoverProductUrls({
      supplier: input.supplier,
      recipe: input.recipe,
      query: input.query,
      searchPageHtml: searchRes.html,
      searchPageUrl: searchRes.finalUrl ?? searchUrl,
      extraLinks: searchRes.links,
      maxCandidates,
    });

    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step: 'discovery',
        status:
          discovery.candidates.length > 0 ? 'candidate_found' : 'candidate_not_found',
        detail: `${discovery.candidates.length} candidatos (extraídos ${discovery.diagnostics.linksExtracted}, do provider ${discovery.diagnostics.linksFromProvider}, rejeitados ${discovery.diagnostics.linksRejected})`,
        linksFromProvider: discovery.diagnostics.linksFromProvider,
      }),
    );

    if (discovery.candidates.length === 0) {
      return finalize(
        buildStatusResult('not_found', 'sem candidatos a produto na página de busca'),
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
      if (
        !hasBudgetRemaining(context, 'elapsed') ||
        !hasBudgetRemaining(context, 'candidateUrl') ||
        !anyProviderCanFetch(providers, context)
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
      candidateUrls.push(candidate.url);

      const prodChain = await fetchThroughProviders(
        providers,
        { url: candidate.url, timeoutMs },
        context,
        'product_fetch',
      );
      if (prodChain.usedFallback) usedFallbackAny = true;
      const prodRes = prodChain.result;

      if (prodRes.status === 'blocked') {
        sawBlocked = true;
        continue;
      }
      if (prodRes.status === 'timeout') {
        sawTimeout = true;
        continue;
      }
      if (prodRes.status !== 'success' || !prodRes.html) {
        sawError = true;
        continue;
      }

      sawCandidateFetched = true;

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
        return finalize(local);
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
        return finalize(buildStatusResult('blocked', 'todos os candidatos foram bloqueados'));
      }
      if (sawTimeout) {
        return finalize(buildStatusResult('timeout', 'todos os candidatos excederam o tempo'));
      }
      if (sawError) {
        return finalize(buildStatusResult('error', 'falha técnica ao coletar os candidatos'));
      }
      return finalize(buildStatusResult('not_found', 'nenhum candidato pôde ser coletado'));
    }

    if (sawProductWithoutPrice) {
      return finalize(
        buildStatusResult(
          'price_not_found',
          'produto encontrado em candidato, mas preço/moeda não foram extraídos',
        ),
      );
    }
    if (bestMismatch) {
      return finalize(bestMismatch.result);
    }
    return finalize(
      buildStatusResult(
        'not_found',
        'candidatos coletados mas nenhum se confirmou como produto compatível',
      ),
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
    return finalize(buildStatusResult(isTimeout ? 'timeout' : 'error', msg));
  }
}

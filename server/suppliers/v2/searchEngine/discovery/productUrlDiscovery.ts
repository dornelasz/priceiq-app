/**
 * productUrlDiscovery — orquestrador da descoberta de URLs de produto (Etapa 6).
 *
 * Fluxo:
 *   1. buildDiscoverySearchUrl  → URL de busca do fornecedor
 *   2. extractUrls              → links limpos do HTML fornecido
 *   3. rankCandidates           → top candidatos de produto
 *
 * Não faz fetch real nesta etapa. Recebe o HTML já obtido (searchPageHtml).
 * Diagnostics em memória usam SearchAttempt da Etapa 5.
 *
 * Função PURA em relação a rede/DB — apenas manipula strings e estruturas.
 */
import { buildDiscoverySearchUrl } from './searchUrlBuilder.js';
import { extractUrls, getSupplierDomain } from './candidateUrlExtractor.js';
import { rankCandidates } from './candidateUrlRanker.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type {
  DiscoverProductUrlsInput,
  DiscoverProductUrlsResult,
  DiscoveryDiagnostics,
} from './discoveryTypes.js';

const DEFAULT_MAX_CANDIDATES = 10;

/**
 * Descobre e rankeia URLs candidatas de produto para um fornecedor + query.
 *
 * Requer `searchPageHtml` para extrair links; sem ele, retorna `no_candidates`
 * (a integração com o NativeFetcher fica para etapa posterior).
 */
export function discoverProductUrls(
  input: DiscoverProductUrlsInput,
): DiscoverProductUrlsResult {
  const {
    supplier,
    recipe,
    query,
    searchPageHtml,
    searchPageUrl,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
  } = input;

  const attempts: SearchAttempt[] = [];

  // ── 1. Construir URL de busca ──────────────────────────────────────────
  const { url: searchUrl, source: urlSource } = buildDiscoverySearchUrl({
    supplier,
    recipe,
    query,
  });

  attempts.push(
    makeSearchAttempt({
      step: 'build_search_url',
      status: 'candidate_found',
      detail: `${urlSource}: ${searchUrl}`,
    }),
  );

  // ── 2. Sem HTML → não há o que extrair ────────────────────────────────
  if (!searchPageHtml) {
    const diagnostics: DiscoveryDiagnostics = {
      searchUrl,
      linksExtracted: 0,
      linksRejected: 0,
      rejectionReasons: {},
      topCandidates: [],
    };

    attempts.push(
      makeSearchAttempt({
        step: 'extract_urls',
        status: 'candidate_not_found',
        detail: 'sem HTML fornecido; integração com NativeFetcher é etapa futura',
      }),
    );

    return { status: 'no_candidates', searchUrl, candidates: [], diagnostics, attempts };
  }

  // ── 3. Extrair links do HTML ───────────────────────────────────────────
  const effectiveBase = searchPageUrl ?? searchUrl;
  const supplierDomain = getSupplierDomain(supplier);

  const { urls: extracted, rejectionReasons } = extractUrls({
    html: searchPageHtml,
    baseUrl: effectiveBase,
    supplierDomain,
  });

  const linksExtracted = extracted.length;
  const linksRejected = Object.values(rejectionReasons).reduce((a, b) => a + b, 0);

  attempts.push(
    makeSearchAttempt({
      step: 'extract_urls',
      status: linksExtracted > 0 ? 'candidate_found' : 'candidate_not_found',
      detail: `${linksExtracted} links extraídos, ${linksRejected} rejeitados`,
    }),
  );

  // ── 4. Rankear candidatos ──────────────────────────────────────────────
  const candidates = rankCandidates(extracted, query, supplierDomain, maxCandidates);

  attempts.push(
    makeSearchAttempt({
      step: 'rank_candidates',
      status: candidates.length > 0 ? 'candidate_found' : 'candidate_not_found',
      detail: `${candidates.length} candidatos de produto após ranking`,
    }),
  );

  const diagnostics: DiscoveryDiagnostics = {
    searchUrl,
    linksExtracted,
    linksRejected,
    rejectionReasons,
    topCandidates: candidates
      .slice(0, 5)
      .map(({ url, score, linkClass }) => ({ url, score, linkClass })),
  };

  if (candidates.length === 0) {
    return { status: 'no_candidates', searchUrl, candidates: [], diagnostics, attempts };
  }

  return { status: 'candidates_found', searchUrl, candidates, diagnostics, attempts };
}

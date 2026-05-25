/**
 * searchPageDiscovery — descobre URLs de produto raspando a PÁGINA DE BUSCA do
 * fornecedor com o motor próprio (Etapa 15).
 *
 * Reaproveita a Etapa 6 (discoverProductUrls) e a Etapa 11 (FetchProvider):
 *   1. buildDiscoverySearchUrl → URL de busca
 *   2. fetchProvider.fetchPage → HTML + links da página de busca
 *   3. discoverProductUrls     → candidatos rankeados
 *
 * NÃO raspa páginas de produto nem extrai preço — só descobre URLs.
 * NUNCA lança: usa o status controlado do FetchProvider.
 */
import { buildDiscoverySearchUrl } from '../discovery/searchUrlBuilder.js';
import { discoverProductUrls } from '../discovery/productUrlDiscovery.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchEngineInternalStatus } from '../core/searchEngineStatus.js';
import type { FetchProvider, FetchProviderStatus } from '../providers/fetchProvider.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';
import type {
  DiscoveredUrl,
  SourceDiscoveryResult,
  SourceFetchStatus,
} from './catalogDiscoveryTypes.js';

/** Traduz o status do FetchProvider para o SourceFetchStatus do catálogo. */
function mapProviderStatus(status: FetchProviderStatus): SourceFetchStatus {
  switch (status) {
    case 'success':
    case 'not_found':
      return 'success'; // respondeu; not_found = página sem candidatos
    case 'blocked':
      return 'blocked';
    case 'rate_limited':
      return 'rate_limited';
    case 'no_credits':
      return 'no_credits';
    case 'timeout':
      return 'timeout';
    case 'disabled':
      return 'disabled';
    case 'error':
    default:
      return 'error';
  }
}

function providerAttemptStatus(status: FetchProviderStatus): SearchEngineInternalStatus {
  switch (status) {
    case 'success':
      return 'native_fetch_success';
    case 'blocked':
      return 'blocked';
    case 'timeout':
      return 'timeout';
    case 'disabled':
      return 'external_provider_disabled';
    default:
      return 'native_fetch_failed';
  }
}

export interface DiscoverViaSearchPageInput {
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
  maxCandidates?: number;
  timeoutMs?: number;
}

/**
 * Busca a página de resultados e extrai candidatos de produto via motor próprio.
 */
export async function discoverViaSearchPage(
  input: DiscoverViaSearchPageInput,
  fetchProvider: FetchProvider,
): Promise<SourceDiscoveryResult> {
  const attempts: SearchAttempt[] = [];

  const { url: searchUrl } = buildDiscoverySearchUrl({
    supplier: input.supplier,
    recipe: input.recipe ?? null,
    query: input.query,
  });

  if (!fetchProvider.enabled) {
    attempts.push(
      makeSearchAttempt({
        step: 'search_page',
        status: 'external_provider_disabled',
        providerName: fetchProvider.name,
        url: searchUrl,
        detail: 'provider de busca desabilitado',
      }),
    );
    return { source: 'search_page', fetchStatus: 'disabled', urls: [], attempts };
  }

  const fetched = await fetchProvider.fetchPage({
    url: searchUrl,
    timeoutMs: input.timeoutMs,
  });

  attempts.push(
    makeSearchAttempt({
      step: 'search_page',
      status: providerAttemptStatus(fetched.status),
      providerName: fetchProvider.name,
      url: searchUrl,
      httpStatus: fetched.httpStatus,
      elapsedMs: fetched.elapsedMs,
      detail: `fetch página de busca → ${fetched.status}`,
    }),
  );

  const fetchStatus = mapProviderStatus(fetched.status);
  if (fetchStatus !== 'success') {
    return {
      source: 'search_page',
      fetchStatus,
      urls: [],
      attempts,
      errorMessage: fetched.errorMessage,
    };
  }

  const discovery = discoverProductUrls({
    supplier: input.supplier,
    recipe: input.recipe ?? null,
    query: input.query,
    searchPageHtml: fetched.html,
    searchPageUrl: fetched.finalUrl ?? searchUrl,
    extraLinks: fetched.links,
    maxCandidates: input.maxCandidates,
  });

  attempts.push(...discovery.attempts);

  const urls: DiscoveredUrl[] = discovery.candidates.map((c) => ({ url: c.url }));

  return { source: 'search_page', fetchStatus: 'success', urls, attempts };
}

/**
 * catalogDiscoveryOrchestrator — coordena as fontes de descoberta e popula o
 * Supplier Product Catalog (Etapa 15).
 *
 * Ordem das fontes:
 *   1. matches reutilizáveis já existentes (apenas leitura — evita refazer)
 *   2. Firecrawl Search   (source='firecrawl_search')
 *   3. Firecrawl Map      (source='firecrawl_map')
 *   4. Sitemap            (source='sitemap')
 *   5. Search Page própria(source='search_page')
 *
 * Para cada fonte habilitada:
 *   - createDiscoveryRun no início
 *   - executa a fonte (sem decidir preço)
 *   - mapeia URLs → candidatos (ranker da Etapa 6)
 *   - upsertCandidate (deduplica por supplier_id + url_hash)
 *   - finishDiscoveryRun com status/contadores
 *
 * NÃO usa Gemini/IA. As chaves do Firecrawl ficam só nos clients (header
 * Authorization). Os defaults vêm de `config`; tudo é injetável para teste.
 */
import { config } from '../../../../config.js';
import {
  supplierProductCatalogService,
  normalizeCatalogQuery,
  type SupplierProductCatalogService,
} from '../../catalog/index.js';
import { createNativeFetchProvider } from '../providers/nativeFetcher.js';
import type { FetchProvider } from '../providers/fetchProvider.js';
import type { SupplierDiscoveryRunStatus } from '../../catalog/index.js';
import { mapDiscoveredUrlsToCandidates } from './catalogDiscoveryMapper.js';
import {
  createFirecrawlSearchClient,
  discoverViaFirecrawlSearch,
  type FirecrawlSearchClient,
} from './firecrawlSearchDiscovery.js';
import {
  createFirecrawlMapClient,
  discoverViaFirecrawlMap,
  type FirecrawlMapClient,
} from './firecrawlMapDiscovery.js';
import { discoverViaSitemap } from './sitemapDiscovery.js';
import { discoverViaSearchPage } from './searchPageDiscovery.js';
import type {
  CatalogDiscoveryInput,
  CatalogDiscoveryResult,
  CatalogDiscoverySource,
  SourceDiscoveryResult,
  SourceFetchStatus,
  SourceOutcome,
} from './catalogDiscoveryTypes.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_MAX_CANDIDATES = 20;
const FIRECRAWL_SEARCH_LIMIT = 10;
const SOURCE_ORDER: CatalogDiscoverySource[] = [
  'firecrawl_search',
  'firecrawl_map',
  'sitemap',
  'search_page',
];

export interface CatalogDiscoveryDeps {
  catalogService?: SupplierProductCatalogService;
  /** null desliga a fonte; undefined resolve a partir de config. */
  firecrawlSearchClient?: FirecrawlSearchClient | null;
  firecrawlMapClient?: FirecrawlMapClient | null;
  sitemapFetch?: FetchLike;
  searchPageProvider?: FetchProvider | null;
  config?: typeof config;
}

interface ResolvedDeps {
  catalogService: SupplierProductCatalogService;
  firecrawlSearchClient: FirecrawlSearchClient | null;
  firecrawlMapClient: FirecrawlMapClient | null;
  sitemapFetch: FetchLike;
  searchPageProvider: FetchProvider | null;
}

function resolveDeps(deps: CatalogDiscoveryDeps): ResolvedDeps {
  const cfg = deps.config ?? config;
  const firecrawlEnabled = cfg.FIRECRAWL_ENABLED;

  const firecrawlSearchClient =
    deps.firecrawlSearchClient !== undefined
      ? deps.firecrawlSearchClient
      : firecrawlEnabled
        ? createFirecrawlSearchClient({
            apiKey: cfg.FIRECRAWL_API_KEY,
            apiUrl: cfg.FIRECRAWL_API_URL,
            timeoutMs: cfg.FIRECRAWL_TIMEOUT_MS,
          })
        : null;

  const firecrawlMapClient =
    deps.firecrawlMapClient !== undefined
      ? deps.firecrawlMapClient
      : firecrawlEnabled
        ? createFirecrawlMapClient({
            apiKey: cfg.FIRECRAWL_API_KEY,
            apiUrl: cfg.FIRECRAWL_API_URL,
            timeoutMs: cfg.FIRECRAWL_TIMEOUT_MS,
          })
        : null;

  return {
    catalogService: deps.catalogService ?? supplierProductCatalogService,
    firecrawlSearchClient,
    firecrawlMapClient,
    sitemapFetch: deps.sitemapFetch ?? fetch,
    searchPageProvider:
      deps.searchPageProvider !== undefined
        ? deps.searchPageProvider
        : createNativeFetchProvider(),
  };
}

function disabledResult(
  source: CatalogDiscoverySource,
  message: string,
): SourceDiscoveryResult {
  return { source, fetchStatus: 'disabled', urls: [], attempts: [], errorMessage: message };
}

/** Deriva o status do discovery_run a partir do fetch e dos candidatos salvos. */
function deriveRunStatus(
  fetchStatus: SourceFetchStatus,
  saved: number,
): SupplierDiscoveryRunStatus {
  if (fetchStatus === 'blocked') return 'blocked';
  if (fetchStatus !== 'success') return saved > 0 ? 'partial' : 'failed';
  return saved > 0 ? 'completed' : 'no_candidates';
}

async function runSource(
  source: CatalogDiscoverySource,
  input: CatalogDiscoveryInput,
  maxCandidates: number,
  resolved: ResolvedDeps,
): Promise<SourceDiscoveryResult> {
  switch (source) {
    case 'firecrawl_search':
      if (!resolved.firecrawlSearchClient) {
        return disabledResult('firecrawl_search', 'firecrawl desabilitado');
      }
      return discoverViaFirecrawlSearch(
        {
          supplier: input.supplier,
          query: input.query,
          maxItems: Math.min(maxCandidates, FIRECRAWL_SEARCH_LIMIT),
        },
        resolved.firecrawlSearchClient,
      );

    case 'firecrawl_map':
      if (!resolved.firecrawlMapClient) {
        return disabledResult('firecrawl_map', 'firecrawl desabilitado');
      }
      return discoverViaFirecrawlMap(
        { supplier: input.supplier, query: input.query, maxItems: maxCandidates },
        resolved.firecrawlMapClient,
      );

    case 'sitemap':
      return discoverViaSitemap({
        supplier: input.supplier,
        query: input.query,
        fetchFn: resolved.sitemapFetch,
      });

    case 'search_page':
      if (!resolved.searchPageProvider) {
        return disabledResult('search_page', 'sem provider de busca');
      }
      return discoverViaSearchPage(
        {
          supplier: input.supplier,
          recipe: input.recipe ?? null,
          query: input.query,
          maxCandidates,
        },
        resolved.searchPageProvider,
      );
  }
}

/**
 * Executa a descoberta de catálogo para um fornecedor + query, persistindo os
 * candidatos e o histórico de runs. Devolve um resumo (sem HTML, sem chave).
 */
export async function runCatalogDiscovery(
  input: CatalogDiscoveryInput,
  deps: CatalogDiscoveryDeps = {},
): Promise<CatalogDiscoveryResult> {
  const resolved = resolveDeps(deps);
  const normalizedQuery = normalizeCatalogQuery(input.query);
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const requested = input.sources ?? SOURCE_ORDER;
  const result: CatalogDiscoveryResult = {
    supplierId: input.supplier.id,
    query: input.query,
    normalizedQuery,
    reusableMatches: 0,
    candidatesFound: 0,
    candidatesSaved: 0,
    candidatesRejected: 0,
    sourceBreakdown: [],
    discoveryRunIds: [],
    attempts: [],
    errors: [],
  };

  // 1. Matches já confirmados (apenas leitura — base para reaproveitamento).
  try {
    const reusable = await resolved.catalogService.listReusableMatches(
      input.supplier.id,
      normalizedQuery,
    );
    result.reusableMatches = reusable.length;
  } catch (e) {
    result.errors.push({ source: 'reusable_matches', message: (e as Error).message });
  }

  // 2-5. Cada fonte habilitada, na ordem canônica.
  for (const source of SOURCE_ORDER) {
    if (!requested.includes(source)) continue;

    const sd = await runSource(source, input, maxCandidates, resolved);
    result.attempts.push(...sd.attempts);

    // Fonte indisponível → registra como 'skipped' sem criar run.
    if (sd.fetchStatus === 'disabled') {
      result.sourceBreakdown.push({
        source,
        runId: null,
        status: 'skipped',
        fetchStatus: 'disabled',
        candidatesFound: 0,
        candidatesSaved: 0,
        candidatesRejected: 0,
        errorMessage: sd.errorMessage,
      });
      continue;
    }

    const run = await resolved.catalogService.createDiscoveryRun({
      supplierId: input.supplier.id,
      queryText: input.query,
      normalizedQuery,
      source,
    });
    result.discoveryRunIds.push(run.id);

    const candidateInputs = mapDiscoveredUrlsToCandidates(
      sd.urls,
      input.supplier,
      input.query,
      normalizedQuery,
      source,
      maxCandidates,
    );

    const found = sd.urls.length;
    let saved = 0;
    for (const candidate of candidateInputs) {
      try {
        await resolved.catalogService.upsertCandidate(candidate);
        saved += 1;
      } catch (e) {
        result.errors.push({ source, message: (e as Error).message });
      }
    }
    const rejected = Math.max(0, found - saved);
    const runStatus = deriveRunStatus(sd.fetchStatus, saved);

    await resolved.catalogService
      .finishDiscoveryRun({
        runId: run.id,
        status: runStatus,
        candidatesFound: found,
        candidatesSaved: saved,
        errorMessage: sd.errorMessage ?? null,
      })
      .catch((e) => {
        result.errors.push({ source, message: (e as Error).message });
      });

    if (sd.errorMessage) result.errors.push({ source, message: sd.errorMessage });

    result.candidatesFound += found;
    result.candidatesSaved += saved;
    result.candidatesRejected += rejected;

    const outcome: SourceOutcome = {
      source,
      runId: run.id,
      status: runStatus,
      fetchStatus: sd.fetchStatus,
      candidatesFound: found,
      candidatesSaved: saved,
      candidatesRejected: rejected,
      errorMessage: sd.errorMessage,
    };
    result.sourceBreakdown.push(outcome);
  }

  return result;
}

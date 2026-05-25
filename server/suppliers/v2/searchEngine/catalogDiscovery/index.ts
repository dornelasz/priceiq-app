/**
 * Barrel do catalogDiscovery (Etapa 15).
 *
 * NOTA: o orquestrador toca em DB (catalog service) e em `config`. Como o
 * barrel principal de searchEngine/ e v2/ devem permanecer importáveis sem
 * DATABASE_URL, este módulo NÃO é re-exportado por eles. Importe direto:
 *
 *   import { runCatalogDiscovery }
 *     from '.../suppliers/v2/searchEngine/catalogDiscovery/index.js';
 */

export type {
  CatalogDiscoverySource,
  DiscoveredUrl,
  SourceFetchStatus,
  SourceDiscoveryResult,
  SourceOutcomeStatus,
  SourceOutcome,
  CatalogDiscoveryInput,
  CatalogDiscoveryResult,
} from './catalogDiscoveryTypes.js';

export { mapDiscoveredUrlsToCandidates } from './catalogDiscoveryMapper.js';

export {
  createFirecrawlSearchClient,
  buildFirecrawlSearchPayload,
  parseFirecrawlSearchItems,
  discoverViaFirecrawlSearch,
  type FirecrawlSearchClient,
  type FirecrawlSearchClientOptions,
  type FirecrawlSearchItem,
  type FirecrawlSearchOutcome,
  type DiscoverViaFirecrawlSearchInput,
} from './firecrawlSearchDiscovery.js';

export {
  createFirecrawlMapClient,
  buildFirecrawlMapPayload,
  parseFirecrawlMapItems,
  discoverViaFirecrawlMap,
  type FirecrawlMapClient,
  type FirecrawlMapClientOptions,
  type FirecrawlMapItem,
  type FirecrawlMapOutcome,
  type DiscoverViaFirecrawlMapInput,
} from './firecrawlMapDiscovery.js';

export {
  discoverViaSitemap,
  parseSitemapLocs,
  parseRobotsSitemaps,
  type DiscoverViaSitemapInput,
} from './sitemapDiscovery.js';

export {
  discoverViaSearchPage,
  type DiscoverViaSearchPageInput,
} from './searchPageDiscovery.js';

export {
  runCatalogDiscovery,
  type CatalogDiscoveryDeps,
} from './catalogDiscoveryOrchestrator.js';

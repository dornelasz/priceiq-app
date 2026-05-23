/**
 * Barrel da camada de HTTP fetch do V2.
 *
 * Uso típico em produção:
 *   import { createFetcherForConfig } from '.../fetching/index.js';
 *   const fetcher = createFetcherForConfig({
 *     firecrawlApiKey: config.FIRECRAWL_API_KEY,
 *     firecrawlMode: config.FIRECRAWL_MODE,
 *   });
 *
 * Em testes: injete qualquer objeto { fetchText } diretamente.
 */
export {
  createDefaultFetcher,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type FetcherResult,
  type FetcherStatus,
  type ContentProvider,
} from './contentFetcher.js';

export {
  createFirecrawlFetcher,
  createFetcherForConfig,
  type FetcherConfig,
} from './firecrawlFetcher.js';

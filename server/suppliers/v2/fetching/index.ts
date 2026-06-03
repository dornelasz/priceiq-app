/**
 * Barrel da camada de HTTP fetch do V2.
 */
export {
  createDefaultFetcher,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type FetcherResult,
  type FetcherStatus,
  type FetcherOptions,
  type ContentType,
  type FetchSource,
} from './contentFetcher.js';

export { fetchViaJina, type JinaResult } from './jinaFetcher.js';
export { fetchViaFirecrawl, type FirecrawlResult } from './firecrawlFetcher.js';

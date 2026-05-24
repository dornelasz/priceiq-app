/**
 * Barrel da camada de descoberta de URLs de produto (Etapa 6).
 */

// Orquestrador principal
export { discoverProductUrls } from './productUrlDiscovery.js';

// Tipos públicos
export type {
  DiscoveryStatus,
  RankedCandidate,
  DiscoveryDiagnostics,
  DiscoverProductUrlsInput,
  DiscoverProductUrlsResult,
} from './discoveryTypes.js';

// SearchUrlBuilder
export {
  buildDiscoverySearchUrl,
  type SearchUrlSource,
  type BuildDiscoverySearchUrlInput,
  type BuildDiscoverySearchUrlResult,
} from './searchUrlBuilder.js';

// Extractor de URLs
export {
  extractUrls,
  normalizeCandidateUrl,
  removeTrackingParams,
  getSupplierDomain,
  type ExtractedUrl,
  type ExtractedUrlSource,
  type ExtractUrlsInput,
  type ExtractUrlsResult,
} from './candidateUrlExtractor.js';

// Ranker de candidatos
export {
  rankCandidates,
  scoreCandidateUrl,
  tokenizeQuery,
} from './candidateUrlRanker.js';

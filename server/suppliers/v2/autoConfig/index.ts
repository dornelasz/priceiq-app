/**
 * Barrel do AutoConfig Engine (Fase C).
 *
 * Uso esperado:
 *
 *   import { autoConfigureSupplier } from '../suppliers/v2/autoConfig/index.js';
 *
 *   const result = await autoConfigureSupplier(supplierId);
 *
 * Para testes, pode-se injetar fetcher e store:
 *
 *   const result = await autoConfigureSupplier(supplierId, {
 *     fetcher: fakeFetcher,
 *     store: fakeStore,
 *     testQuery: 'caneta',
 *   });
 */

export {
  detectPlatform,
  type PlatformDetectorInput,
  type PlatformDetectorResult,
} from './platformDetector.js';

export {
  discoverSearchUrl,
  type SearchDiscoveryInput,
  type SearchDiscoveryMethod,
  type SearchDiscoveryResult,
} from './searchDiscoverer.js';

export {
  detectProductCandidates,
  isLikelyProductPage,
  type ProductCandidate,
  type ProductCandidatesInput,
  type ProductCandidatesResult,
  type ProductPageInput,
  type ProductPageResult,
} from './productPageDetector.js';

export {
  detectExtractionStrategy,
  type ExtractorDetectorInput,
  type ExtractorDetectorResult,
} from './extractorDetector.js';

export {
  buildSupplierRecipe,
  type RecipeBuildInput,
} from './recipeBuilder.js';

export {
  certifyRecipeCandidate,
  type CertifierInput,
  type CertifierResult,
} from './supplierCertifier.js';

export {
  autoConfigureSupplier,
  createDefaultFetcher,
  type AutoConfigOptions,
  type Fetcher,
  type FetcherResult,
  type FetcherStatus,
  type SupplierStore,
} from './autoConfigureSupplier.js';

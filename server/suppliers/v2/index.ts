/**
 * Barrel do contrato V2 do motor de busca.
 *
 * Importação preferida em código novo:
 *
 *   import {
 *     type UniversalSearchResult,
 *     type SupplierRecipe,
 *     universalSearchResultSchema,
 *     isValidatedUniversalSearchResult,
 *   } from '../suppliers/v2/index.js';
 *
 * A partir da Fase D, este barrel também expõe o Recipe Runner e os
 * extractors estruturados. Importar deles ainda é seguro: o Runner só
 * dispara I/O quando explicitamente chamado, e os extractors são puros.
 */

export type {
  SupplierCertificationStatus,
  SearchResultStatusV2,
  FreightStatus,
  LinkType,
  ExtractionStrategy,
  SearchEvidence,
  UniversalSearchResult,
  SupplierRecipe,
  SupplierAutoConfigResult,
} from './types.js';

export {
  SUPPLIER_CERTIFICATION_STATUSES,
  SEARCH_RESULT_STATUSES_V2,
  FREIGHT_STATUSES,
  LINK_TYPES,
  EXTRACTION_STRATEGIES,
} from './types.js';

export {
  supplierCertificationStatusSchema,
  searchResultStatusV2Schema,
  freightStatusSchema,
  linkTypeSchema,
  extractionStrategySchema,
  searchEvidenceSchema,
  universalSearchResultSchema,
  supplierRecipeSchema,
  supplierAutoConfigResultSchema,
} from './schemas.js';

export {
  isValidatedUniversalSearchResult,
  canConfirmFinalTotal,
} from './validators.js';

// ─── Fase D — Recipe Runner + extractors estruturados ─────────────────
export {
  createDefaultFetcher,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type FetcherResult,
  type FetcherStatus,
  type ContentProvider,
  createFirecrawlFetcher,
  createFetcherForConfig,
  type FetcherConfig,
} from './fetching/index.js';

export {
  runSupplierRecipe,
  validateRecipe,
  extractCandidates,
  buildStatusResult,
  buildValidatedResult,
  buildMismatchResult,
  type RunSupplierRecipeInput,
  type RecipeValidationResult,
  type CandidateUrl,
} from './recipeRunner/index.js';

export {
  EXTRACTORS_IN_ORDER,
  extractFromJsonLd,
  extractFromMetaTags,
  extractFromNextData,
  extractFromScriptJson,
  extractFromDom,
  detectFreeShipping,
  type ExtractedProductData,
  type RegisteredExtractor,
  type ExtractorFn,
  // Etapa 4
  parseMoney,
  parseAmount,
  detectCurrency,
  findPriceCandidates,
  rankPriceCandidates,
  pickPrincipalPrice,
  extractFreight,
  detectAvailability,
  classifyUrl,
  isProductUrl,
  extractFromMarkdown,
  extractLocalProduct,
  type SupportedCurrency,
  type PriceCandidate,
  type FreightExtraction,
  type FreightState,
  type AvailabilityResult,
  type LinkClass,
  type UrlClassification,
  type MarkdownExtractInput,
  type LocalExtractionInput,
} from './extractors/index.js';

export { matchProduct, type MatchResult } from './matching/index.js';

// NOTA: módulos que tocam em DB/I/O (autoConfig, integration) NÃO são
// re-exportados aqui para manter este barrel seguro de importar sem
// `DATABASE_URL` definido. Importe-os diretamente dos sub-paths:
//   import { autoConfigureSupplier } from '.../suppliers/v2/autoConfig/index.js';
//   import { mapUniversalResultToInsertPayload } from '.../suppliers/v2/integration/index.js';

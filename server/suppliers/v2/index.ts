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
 * Esta camada é APENAS contratos/validações. Nenhum import daqui dispara
 * I/O, scraping, banco ou cotação. Pode ser usada com segurança em qualquer
 * arquivo do servidor.
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

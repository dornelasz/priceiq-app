/**
 * Barrel do Supplier Product Catalog (Etapa 14).
 *
 * NOTA: este módulo toca em DB (via supplierProductCatalogService).
 * Não é re-exportado pelo barrel principal de v2/ para manter aquele barrel
 * seguro de importar sem DATABASE_URL definido.
 *
 * Importe diretamente:
 *   import { supplierProductCatalogService, ... }
 *     from '.../suppliers/v2/catalog/index.js';
 */

export type {
  SupplierProductCandidate,
  SupplierProductCandidateStatus,
  SupplierProductSource,
  SupplierProductMatch,
  SupplierProductMatchStatus,
  SupplierDiscoveryRun,
  SupplierDiscoveryRunStatus,
  SupplierDiscoverySource,
  UpsertCandidateInput,
  UpdateCandidateExtractionInput,
  CreateDiscoveryRunInput,
  FinishDiscoveryRunInput,
  CreateOrUpdateMatchInput,
} from './catalogTypes.js';

export {
  MAX_EVIDENCE_LENGTH,
  normalizeCatalogQuery,
  hashProductUrl,
  truncateEvidenceText,
  createSupplierProductCatalogService,
  supplierProductCatalogService,
  type SupplierProductCatalogService,
} from './supplierProductCatalogService.js';

export { mapRankedCandidatesToCatalog } from './candidateMapper.js';

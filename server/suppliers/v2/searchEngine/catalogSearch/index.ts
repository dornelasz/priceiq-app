/**
 * Barrel do catalogSearch (Etapa 17).
 *
 * NOTA: o orquestrador toca em DB (catalog service) e em `config`. Não é
 * re-exportado pelos barrels de searchEngine/ e v2/ (que devem ser importáveis
 * sem DATABASE_URL). Importe direto:
 *
 *   import { runCatalogFirstSupplierSearch }
 *     from '.../suppliers/v2/searchEngine/catalogSearch/index.js';
 */

export type {
  CatalogSearchStatus,
  CatalogSearchStrategy,
  CatalogSearchInput,
  UsefulResult,
  FailedResult,
  CatalogSearchDiagnostics,
  CatalogSearchResult,
} from './catalogSearchTypes.js';

export {
  buildUsefulResults,
  buildFailures,
  candidateListToMap,
} from './catalogSearchResultMapper.js';

export { buildDiagnostics } from './catalogSearchDiagnostics.js';

export {
  runCatalogFirstSupplierSearch,
  type CatalogSearchDeps,
} from './catalogSearchOrchestrator.js';

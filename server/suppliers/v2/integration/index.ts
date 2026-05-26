/**
 * Barrel da camada de integração V2 ↔ worker/busca legados.
 */
export {
  mapUniversalResultToInsertPayload,
  mapV2StatusToLegacy,
  type ConvertToBrl,
  type MapInput,
  type StatusMapping,
} from './workerAdapter.js';

export {
  mapCatalogSearchResultToPayload,
  pickBestUseful,
  pickRepresentativeFailure,
  type CatalogPayloadOutcome,
} from './catalogSearchWorkerAdapter.js';

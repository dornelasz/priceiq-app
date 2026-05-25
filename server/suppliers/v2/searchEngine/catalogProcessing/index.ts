/**
 * Barrel do catalogProcessing (Etapa 16).
 *
 * NOTA: o orquestrador toca em DB (catalog service) e em `config`. Não é
 * re-exportado pelos barrels de searchEngine/ e v2/ (que devem ser importáveis
 * sem DATABASE_URL). Importe direto:
 *
 *   import { processCatalogCandidates }
 *     from '.../suppliers/v2/searchEngine/catalogProcessing/index.js';
 */

export type {
  CatalogProcessingInput,
  CatalogProcessingResult,
  CatalogProcessingStatus,
  CandidateProcessingStatus,
  ProcessedCandidate,
} from './catalogProcessingTypes.js';

export {
  decideMatch,
  type MatchDecision,
  type MatchDecisionOptions,
} from './catalogMatchBuilder.js';

export { mapResultToCandidateUpdate } from './catalogProcessingMapper.js';

export {
  processOneCandidate,
  type ProcessOneInput,
  type ProcessOneOutcome,
} from './catalogCandidateProcessor.js';

export {
  processCatalogCandidates,
  type CatalogProcessingDeps,
} from './catalogProcessingOrchestrator.js';

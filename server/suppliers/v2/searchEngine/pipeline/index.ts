/**
 * Barrel do pipeline próprio executável (Etapa 7).
 */
export { runOwnSearchPipeline } from './ownSearchPipeline.js';

export {
  mapFetchStatusToResultStatus,
  classifyExtractionForDiagnostics,
  isUsefulExtraction,
} from './pipelineResultMapper.js';

export {
  mapToDiagnosticResponse,
  deriveDiagnosticStatus,
  sanitizeAttempts,
  type DiagnosticStatus,
  type DiagnosticResultView,
  type SanitizedAttempt,
  type DiagnosticResponse,
  type MapDiagnosticInput,
} from './diagnosticResponseMapper.js';

export type {
  RunOwnSearchPipelineInput,
  OwnSearchPipelineOutcome,
} from './pipelineTypes.js';

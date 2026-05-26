/**
 * catalogSearchDiagnostics — constrói o resumo de diagnóstico do fluxo
 * catalog-first (Etapa 17).
 */
import type { CatalogDiscoveryResult } from '../catalogDiscovery/catalogDiscoveryTypes.js';
import type { CatalogProcessingResult } from '../catalogProcessing/catalogProcessingTypes.js';
import type { CatalogSearchDiagnostics } from './catalogSearchTypes.js';

export function buildDiagnostics(
  reusableMatchesFound: number,
  discoveryResult: CatalogDiscoveryResult | null,
  processingResult: CatalogProcessingResult | null,
): CatalogSearchDiagnostics {
  const candidatesDiscoveredBySource: Record<string, number> = {};
  if (discoveryResult) {
    for (const outcome of discoveryResult.sourceBreakdown) {
      if (outcome.candidatesSaved > 0) {
        candidatesDiscoveredBySource[outcome.source] =
          (candidatesDiscoveredBySource[outcome.source] ?? 0) + outcome.candidatesSaved;
      }
    }
  }

  const processingStatusBreakdown = processingResult?.statusBreakdown ?? {};

  const attemptCount =
    (discoveryResult?.attempts.length ?? 0) +
    (processingResult?.attempts.length ?? 0);

  return {
    reusableMatchesFound,
    candidatesDiscoveredBySource,
    processingStatusBreakdown,
    attemptCount,
  };
}

/**
 * catalogSearchResultMapper — converte ProcessedCandidate[] + candidatos do banco
 * em UsefulResult[] e FailedResult[] (Etapa 17).
 *
 * Regras:
 *  - validated/partial + evidência + preço → UsefulResult
 *  - frete desconhecido permanece null (nunca 0)
 *  - qualquer outro status → FailedResult
 */
import type { SupplierProductCandidate } from '../../catalog/index.js';
import type { ProcessedCandidate } from '../catalogProcessing/catalogProcessingTypes.js';
import type { UsefulResult, FailedResult } from './catalogSearchTypes.js';

export function candidateListToMap(
  candidates: SupplierProductCandidate[],
): Map<string, SupplierProductCandidate> {
  return new Map(candidates.map((c) => [c.id, c]));
}

export function buildUsefulResults(
  processed: ProcessedCandidate[],
  candidatesById: Map<string, SupplierProductCandidate>,
): UsefulResult[] {
  const results: UsefulResult[] = [];
  for (const p of processed) {
    if (p.candidateStatus !== 'validated' && p.candidateStatus !== 'partial') continue;
    const c = candidatesById.get(p.candidateId);
    if (!c) continue;
    if (!c.evidenceText || c.price == null) continue;
    results.push({
      candidateId: p.candidateId,
      productUrl: p.productUrl,
      productName: c.productName,
      price: c.price,
      currency: c.currency,
      priceBrl: c.priceBrl,
      freight: c.freight,
      freightStatus: c.freightStatus,
      totalBrl: c.totalBrl,
      matchScore: c.matchScore,
      confidence: c.confidence,
      evidenceText: c.evidenceText,
      status: p.candidateStatus as 'validated' | 'partial',
      matchStatus: p.matchStatus,
    });
  }
  return results;
}

export function buildFailures(processed: ProcessedCandidate[]): FailedResult[] {
  const failures: FailedResult[] = [];
  for (const p of processed) {
    if (p.candidateStatus === 'validated' || p.candidateStatus === 'partial') continue;
    failures.push({
      candidateId: p.candidateId,
      productUrl: p.productUrl,
      status: p.status,
    });
  }
  return failures;
}

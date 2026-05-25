/**
 * catalogProcessingMapper — converte o UniversalSearchResult + decisão de match
 * em um UpdateCandidateExtractionInput para persistência (Etapa 16).
 *
 * Garantias:
 *   - Nunca salva HTML bruto — só o evidenceText (snippet), truncado pelo serviço.
 *   - Sem cotação: priceBrl/totalBrl só ecoam o valor quando a moeda já é BRL;
 *     caso contrário ficam null (conversão é responsabilidade do worker).
 *   - Frete desconhecido permanece null (NUNCA 0).
 *
 * Função PURA — sem I/O.
 */
import type { UniversalSearchResult } from '../../types.js';
import type { UpdateCandidateExtractionInput } from '../../catalog/index.js';
import type { MatchDecision } from './catalogMatchBuilder.js';

function isBrl(currency: string | null | undefined): boolean {
  return (currency ?? '').toUpperCase() === 'BRL';
}

/**
 * Monta o update do candidato a partir do resultado e da decisão.
 * Para resultados não-extraídos (blocked/timeout), passe apenas o candidateStatus
 * via `statusOnly` — os campos de extração ficam nulos (match_score preservado).
 */
export function mapResultToCandidateUpdate(
  candidateId: string,
  result: UniversalSearchResult,
  decision: MatchDecision,
): UpdateCandidateExtractionInput {
  const brl = isBrl(result.currency);
  const price = typeof result.price === 'number' ? result.price : null;
  const totalPrice = typeof result.totalPrice === 'number' ? result.totalPrice : null;

  // Só preenche dados de produto quando há extração útil (validated/partial).
  const extracted =
    result.status === 'validated'; // 'partial' também vem de status 'validated'

  return {
    candidateId,
    status: decision.candidateStatus,
    productName: extracted ? (result.productName ?? null) : null,
    brand: null,
    sku: null,
    price: extracted ? price : null,
    currency: extracted ? (result.currency ?? null) : null,
    priceBrl: extracted && brl ? price : null,
    // Frete desconhecido → null (nunca 0). free_confirmed legitimamente = 0.
    freight: extracted ? (typeof result.freight === 'number' ? result.freight : null) : null,
    freightStatus: extracted ? result.freightStatus : null,
    totalBrl: extracted && brl ? totalPrice : null,
    matchScore: typeof result.matchScore === 'number' ? result.matchScore : null,
    confidence: typeof result.confidence === 'number' ? result.confidence : null,
    evidenceText: extracted ? (result.evidence?.evidenceText ?? null) : null,
    priceEvidenceText: null,
  };
}

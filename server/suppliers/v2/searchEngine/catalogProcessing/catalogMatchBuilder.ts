/**
 * catalogMatchBuilder — decide, a partir do UniversalSearchResult, qual status
 * o candidato recebe e se/como um match é criado (Etapa 16).
 *
 * Regras (mantêm as Etapas 3/4):
 *   - validated + frete confirmado/grátis  → candidato 'validated'
 *   - validated + frete desconhecido/estim → candidato 'partial' (preço útil)
 *   - product_mismatch                     → candidato 'product_mismatch' + match rejected
 *   - price_not_found                      → candidato 'price_not_found', sem match
 *   - invalid_link / not_found             → candidato 'rejected', sem match
 *   - blocked / timeout                    → candidato 'blocked', sem match
 *
 * Match (confirmed/pending) só é criado para validated/partial com evidência +
 * preço + productUrl + score >= minMatchScore. confirmed quando score alto,
 * pending quando médio.
 *
 * Função PURA — sem I/O.
 */
import type { UniversalSearchResult } from '../../types.js';
import type {
  SupplierProductCandidateStatus,
  SupplierProductMatchStatus,
} from '../../catalog/index.js';
import type { CandidateProcessingStatus } from './catalogProcessingTypes.js';

export interface MatchDecisionOptions {
  minMatchScore: number;
  trustedScore: number;
}

export interface MatchDecision {
  processingStatus: CandidateProcessingStatus;
  candidateStatus: SupplierProductCandidateStatus;
  createMatch: boolean;
  matchStatus: SupplierProductMatchStatus | null;
  reason: string | null;
}

function isFinalFreight(result: UniversalSearchResult): boolean {
  return (
    result.freightStatus === 'confirmed' ||
    result.freightStatus === 'free_confirmed'
  );
}

/**
 * Decide a ação (status do candidato + match) a partir de um resultado de
 * extração. Não toca em banco.
 */
export function decideMatch(
  result: UniversalSearchResult,
  opts: MatchDecisionOptions,
): MatchDecision {
  switch (result.status) {
    case 'validated': {
      const final = isFinalFreight(result);
      const candidateStatus: SupplierProductCandidateStatus = final
        ? 'validated'
        : 'partial';
      const processingStatus: CandidateProcessingStatus = final
        ? 'validated'
        : 'partial';

      const score = result.matchScore ?? 0;
      const hasEvidence = !!result.evidence?.evidenceText;
      const hasPrice = typeof result.price === 'number' && result.price > 0;
      const hasProductUrl = !!result.productUrl;

      if (hasEvidence && hasPrice && hasProductUrl && score >= opts.minMatchScore) {
        const matchStatus: SupplierProductMatchStatus =
          score >= opts.trustedScore ? 'confirmed' : 'pending';
        return {
          processingStatus,
          candidateStatus,
          createMatch: true,
          matchStatus,
          reason: `match score ${score} (${matchStatus})`,
        };
      }

      // Validado mas sem condições para match (raro) — atualiza candidato só.
      return {
        processingStatus,
        candidateStatus,
        createMatch: false,
        matchStatus: null,
        reason: 'validado sem evidência/preço/url suficientes para match',
      };
    }

    case 'product_mismatch':
      return {
        processingStatus: 'product_mismatch',
        candidateStatus: 'product_mismatch',
        createMatch: true,
        matchStatus: 'rejected',
        reason: result.errorMessage ?? 'produto incompatível com a query',
      };

    case 'price_not_found':
      return {
        processingStatus: 'price_not_found',
        candidateStatus: 'price_not_found',
        createMatch: false,
        matchStatus: null,
        reason: result.errorMessage ?? 'preço não encontrado',
      };

    case 'invalid_link':
      return {
        processingStatus: 'invalid_link',
        candidateStatus: 'rejected',
        createMatch: false,
        matchStatus: null,
        reason: result.errorMessage ?? 'link inválido para produto',
      };

    case 'blocked':
      return {
        processingStatus: 'blocked',
        candidateStatus: 'blocked',
        createMatch: false,
        matchStatus: null,
        reason: result.errorMessage ?? 'acesso bloqueado',
      };

    case 'timeout':
      return {
        processingStatus: 'timeout',
        candidateStatus: 'blocked',
        createMatch: false,
        matchStatus: null,
        reason: result.errorMessage ?? 'tempo esgotado',
      };

    case 'not_found':
    default:
      return {
        processingStatus: 'not_found',
        candidateStatus: 'rejected',
        createMatch: false,
        matchStatus: null,
        reason: result.errorMessage ?? 'produto/evidência não identificados',
      };
  }
}

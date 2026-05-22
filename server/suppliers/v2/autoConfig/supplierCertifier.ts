/**
 * Decide o status de certificação final de um SupplierRecipe candidato.
 *
 * Função PURA — não toca em I/O. Pode (e deve) ser testada com fixtures.
 *
 * Estados possíveis (alinhados com SupplierCertificationStatus):
 *  - certified           — tudo OK e confidence >= 70
 *  - needs_guided_setup  — algum sinal, mas não o suficiente
 *  - blocked             — captcha/cloudflare/403/429/451
 *  - requires_login      — área de catálogo/preço atrás de login
 *  - unsupported         — sem busca, sem produto, sem preço
 *  - failed              — erro técnico inesperado (fetch quebrou)
 *
 * Receitas legadas (apenas com search_url_template antigo) NUNCA são
 * certified — precisam passar pelos detectores para isso.
 */
import type { SupplierCertificationStatus, SupplierRecipe } from '../types.js';

export interface CertifierInput {
  recipe: SupplierRecipe;
  discovery: {
    hasSearchUrl: boolean;
    searchConfidence: number;
    hasProductSignal: boolean;
    productConfidence: number;
    hasExtractionStrategy: boolean;
    extractorConfidence: number;
    blocked: boolean;
    requiresLogin: boolean;
    fetchFailed?: boolean;
  };
}

export interface CertifierResult {
  status: SupplierCertificationStatus;
  confidence: number;
  reason?: string;
}

const CERTIFIED_MIN_CONFIDENCE = 70;

export function certifyRecipeCandidate(
  input: CertifierInput,
): CertifierResult {
  const d = input.discovery;

  // ─── Estados de exceção têm precedência ──────────────────────────────
  if (d.blocked) {
    return {
      status: 'blocked',
      confidence: 0,
      reason: 'Fornecedor bloqueado (captcha / cloudflare / 403 / 429 / 451)',
    };
  }
  if (d.requiresLogin) {
    return {
      status: 'requires_login',
      confidence: 0,
      reason: 'Fornecedor exige login para visualizar catálogo/preços',
    };
  }
  if (d.fetchFailed) {
    return {
      status: 'failed',
      confidence: 0,
      reason: 'Erro técnico durante autoconfig (fetch não retornou conteúdo)',
    };
  }

  // ─── Caminho feliz: certified ────────────────────────────────────────
  if (d.hasSearchUrl && d.hasProductSignal && d.hasExtractionStrategy) {
    const score = Math.round(
      (d.searchConfidence + d.productConfidence + d.extractorConfidence) / 3,
    );
    if (score >= CERTIFIED_MIN_CONFIDENCE) {
      return {
        status: 'certified',
        confidence: score,
        reason: 'Busca + produto + estratégia de extração detectados com alta confiança',
      };
    }
  }

  // ─── Nada detectado → unsupported ────────────────────────────────────
  if (!d.hasSearchUrl && !d.hasProductSignal && !d.hasExtractionStrategy) {
    return {
      status: 'unsupported',
      confidence: 0,
      reason: 'Sem busca, página de produto ou preço público detectáveis',
    };
  }

  // ─── Algum sinal mas insuficiente → needs_guided_setup ──────────────
  const components: number[] = [];
  if (d.hasSearchUrl) components.push(d.searchConfidence);
  if (d.hasProductSignal) components.push(d.productConfidence);
  if (d.hasExtractionStrategy) components.push(d.extractorConfidence);
  const score =
    components.length > 0
      ? Math.round(components.reduce((a, b) => a + b, 0) / components.length)
      : 0;

  return {
    status: 'needs_guided_setup',
    confidence: score,
    reason:
      'Sinais parciais detectados; precisa de configuração guiada para virar certified',
  };
}

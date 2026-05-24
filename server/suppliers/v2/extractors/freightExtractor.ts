/**
 * Extrator de frete reforçado — distingue 3 estados com evidência:
 *   - free_confirmed : "frete grátis" / "free shipping" explícito.
 *   - confirmed      : valor numérico de frete rotulado ("frete R$ 19,90").
 *   - not_available  : nenhuma evidência → freight = null.
 *
 * Princípios absolutos (Etapa 3 + 4):
 *   - Frete desconhecido NUNCA vira 0.
 *   - freight = 0 SÓ com evidência explícita de gratuidade.
 *   - Valor de frete só é aceito quando rotulado como frete/shipping/envio,
 *     para nunca confundir com o preço do produto.
 *
 * Função PURA. Mantém `detectFreeShipping` (freightHints) intacto; este é o
 * extrator completo que o orquestrador usa.
 */
import {
  parseAmount,
  type SupportedCurrency,
} from './moneyParser.js';

export type FreightState =
  | 'not_available'
  | 'free_confirmed'
  | 'confirmed'
  | 'estimated';

export interface FreightExtraction {
  state: FreightState;
  value: number | null;
  evidence: string | null;
}

const FREE_SHIPPING_RX =
  /\b(?:frete\s*gr[áa]tis|envio\s*gr[áa]tis|env[ií]o\s*gratis|free\s*shipping|free\s*delivery|包邮)\b/i;

// "frete R$ 19,90", "shipping US$ 12.50", "envio € 5,00". O rótulo precede o valor.
const PAID_FREIGHT_RX =
  /\b(?:frete|shipping|env[ií]o|entrega)\b[^\d]{0,30}(R\$|US\$|USD|BRL|EUR|RMB|CNY|€|¥|\$)\s*([\d.,]+)/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function snippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + len + 40);
  return text.slice(start, end).trim();
}

/**
 * Extrai o estado de frete de um conteúdo (HTML ou texto/markdown).
 * `currency` orienta o parse do valor pago.
 */
export function extractFreight(
  content: string,
  currency: SupportedCurrency,
): FreightExtraction {
  const text = stripTags(content);

  // 1. Frete grátis tem prioridade — gratuidade explícita vence valor pago.
  const free = text.match(FREE_SHIPPING_RX);
  if (free && free[0]) {
    return {
      state: 'free_confirmed',
      value: 0,
      evidence: snippet(text, free.index ?? 0, free[0].length),
    };
  }

  // 2. Valor de frete rotulado.
  const paid = text.match(PAID_FREIGHT_RX);
  if (paid && paid[2]) {
    const value = parseAmount(paid[2], currency);
    // Frete plausível: > 0 e abaixo de um teto que evita capturar preço de produto.
    if (value !== null && value > 0 && value < 5000) {
      return {
        state: 'confirmed',
        value,
        evidence: snippet(text, paid.index ?? 0, paid[0].length),
      };
    }
  }

  // 3. Nada confiável → desconhecido (NUNCA 0).
  return { state: 'not_available', value: null, evidence: null };
}

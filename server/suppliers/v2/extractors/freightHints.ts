/**
 * Detecção mínima de evidência de FRETE GRÁTIS no HTML do produto.
 *
 * Princípio absoluto: frete desconhecido NUNCA vira 0 nesta fase. Apenas
 * quando o site declara explicitamente "frete grátis" / "envio grátis" /
 * "free shipping" liberamos `free_confirmed`.
 *
 * Para valor numérico de frete confirmado (NÃO frete grátis), deixamos
 * para a Fase com freight calculator completo — aqui retornamos sempre
 * `not_available` quando não há evidência de gratuidade.
 *
 * Função PURA — não toca rede ou DB.
 */

const FREE_SHIPPING_RX =
  /\b(?:frete\s*gr[áa]tis|envio\s*gr[áa]tis|free\s*shipping|free\s*delivery)\b/i;

export interface FreightHintResult {
  isFreeShipping: boolean;
  evidence: string | null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectFreeShipping(html: string): FreightHintResult {
  const text = stripTags(html);
  const m = text.match(FREE_SHIPPING_RX);
  if (m && m[0]) {
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + m[0].length + 40);
    return {
      isFreeShipping: true,
      evidence: text.slice(start, end).trim(),
    };
  }
  return { isFreeShipping: false, evidence: null };
}

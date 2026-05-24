/**
 * Detecção de disponibilidade a partir de texto/HTML.
 *
 *   true  → em estoque / disponível / in stock
 *   false → esgotado / indisponível / out of stock / sold out
 *   null  → sem sinal claro (não assume nada)
 *
 * Indisponibilidade tem prioridade sobre disponibilidade (um "esgotado"
 * explícito vence um "disponível" genérico de template).
 *
 * Função PURA.
 */

const OUT_OF_STOCK_RX =
  /\b(?:esgotado|indispon[íi]vel|fora\s*de\s*estoque|sem\s*estoque|out\s*of\s*stock|sold\s*out|unavailable)\b/i;

const IN_STOCK_RX =
  /\b(?:em\s*estoque|dispon[íi]vel|pronta\s*entrega|in\s*stock|available|schema\.org\/InStock)\b/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface AvailabilityResult {
  available: boolean | null;
  evidence: string | null;
}

export function detectAvailability(content: string): AvailabilityResult {
  const text = stripTags(content);

  const out = text.match(OUT_OF_STOCK_RX);
  if (out && out[0]) return { available: false, evidence: out[0] };

  const inStock = text.match(IN_STOCK_RX);
  if (inStock && inStock[0]) return { available: true, evidence: inStock[0] };

  return { available: null, evidence: null };
}

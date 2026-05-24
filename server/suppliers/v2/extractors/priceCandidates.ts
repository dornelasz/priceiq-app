/**
 * Sistema de candidatos de preço.
 *
 * Em vez de pegar o primeiro número que parece preço (frágil), varremos TODO
 * o texto, montamos candidatos com contexto e os ranqueamos. Isso evita os
 * erros clássicos:
 *   - parcela ("12x de R$ 233,25") virar preço principal
 *   - frete ("frete R$ 19,90") virar preço do produto
 *   - desconto/cupom/economia virar preço
 *   - preço antigo riscado ("de R$ 999") vencer o preço à vista
 *
 * Função PURA — não toca rede, DB nem IA. Usa o parser monetário compartilhado.
 */
import {
  detectCurrency,
  parseAmount,
  type SupportedCurrency,
} from './moneyParser.js';

export interface PriceCandidate {
  rawText: string;
  value: number;
  currency: SupportedCurrency;
  contextBefore: string;
  contextAfter: string;
  source: string;
  confidence: number; // 0–100
  reason: string;
}

// Token monetário + número. O número aceita milhar/decimal em ambos formatos.
const NUMBER = '\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const PRICE_SCAN_RX = new RegExp(
  `(R\\$|US\\$|USD|BRL|EUR|RMB|CNY|€|¥|\\$)\\s*(${NUMBER})`,
  'gi',
);

const CONTEXT_BEFORE = 70;
const CONTEXT_AFTER = 40;

/** Faixas plausíveis por moeda — descarta ruído (ex: "$5" de gorjeta, milhões absurdos). */
const PRICE_RANGE: Record<SupportedCurrency, [number, number]> = {
  BRL: [3, 1_000_000],
  USD: [1, 500_000],
  EUR: [1, 500_000],
  CNY: [3, 1_000_000],
};

/**
 * Contextos que indicam que o número NÃO é o preço do produto.
 * Olhamos `contextBefore` (texto imediatamente antes do valor).
 */
const NON_PRINCIPAL_BEFORE: Array<{ rx: RegExp; penalty: number; reason: string }> = [
  { rx: /\d+\s*x\s*(?:de\s*)?$/i, penalty: 70, reason: 'parcela (Nx de)' },
  { rx: /\bem\s+\d+\s*x[^\d]*$/i, penalty: 70, reason: 'parcelamento' },
  { rx: /\b(frete|shipping|env[ií]o|entrega)\b[^\d]{0,20}$/i, penalty: 80, reason: 'frete' },
  { rx: /\b(desconto|cupom|economia|economize|poupe|off)\b[^\d]{0,20}$/i, penalty: 60, reason: 'desconto/cupom' },
  { rx: /\b(de|antes|por)\s*:?\s*$/i, penalty: 35, reason: 'preço antigo (de/antes)' },
];

/** Contextos que reforçam que é o preço principal. */
const PRINCIPAL_SIGNALS: Array<{ rx: RegExp; bonus: number; reason: string }> = [
  { rx: /\b(à\s*vista|a\s*vista)\b/i, bonus: 25, reason: 'à vista' },
  { rx: /\b(no\s*)?pix\b/i, bonus: 22, reason: 'pix' },
  { rx: /\bboleto\b/i, bonus: 12, reason: 'boleto' },
  { rx: /\b(sale\s*price|sale|oferta|promo[cç][aã]o)\b/i, bonus: 18, reason: 'oferta/sale' },
  { rx: /\b(por\s*apenas|apenas|preç?o)\b/i, bonus: 8, reason: 'preço/apenas' },
];

/** "10x de R$" / "12 x R$" depois do valor riscado, etc. no contextAfter. */
const NON_PRINCIPAL_AFTER: Array<{ rx: RegExp; penalty: number; reason: string }> = [
  { rx: /^\s*(?:em|in)\s*\d+\s*x/i, penalty: 30, reason: 'seguido de parcelamento' },
  { rx: /^\s*\/\s*(?:m[êe]s|month|mo\b)/i, penalty: 50, reason: 'preço por mês (assinatura)' },
];

/** Números que aparecem em contexto claramente não-monetário (avaliação, GB, ano…). */
function looksLikeNonPrice(before: string, after: string): boolean {
  if (/\b(avalia[cç][aã]o|review|nota|estrelas?|rating)\b[^\d]{0,8}$/i.test(before)) return true;
  if (/^\s*(estrelas?|de\s+5|avalia[cç][oõ]es|reviews?)/i.test(after)) return true;
  if (/^\s*(vendidos?|unidades?\s+vendidas?|sold)/i.test(after)) return true;
  if (/^\s*(gb|mb|tb|kb|mm|cm|kg|ml|hz|fps|polegadas|inch|ano|year)\b/i.test(after)) return true;
  return false;
}

export interface FindPriceCandidatesOptions {
  /** Se definido, só aceita candidatos nesta moeda. */
  expectedCurrency?: SupportedCurrency;
  source?: string;
}

/**
 * Varre o texto e devolve todos os candidatos a preço plausíveis (não ranqueados).
 */
export function findPriceCandidates(
  text: string,
  opts: FindPriceCandidatesOptions = {},
): PriceCandidate[] {
  if (!text) return [];
  const out: PriceCandidate[] = [];
  const seen = new Set<string>();
  PRICE_SCAN_RX.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = PRICE_SCAN_RX.exec(text)) !== null) {
    const token = m[1] ?? '';
    const numRaw = m[2] ?? '';
    const currency = detectCurrency(token);
    if (!currency) continue;
    if (opts.expectedCurrency && currency !== opts.expectedCurrency) continue;

    const value = parseAmount(numRaw, currency);
    if (value === null) continue;
    const [min, max] = PRICE_RANGE[currency];
    if (value < min || value > max) continue;

    const pos = m.index;
    const matchLen = m[0]?.length ?? 0;
    const contextBefore = text.slice(Math.max(0, pos - CONTEXT_BEFORE), pos);
    const contextAfter = text.slice(pos + matchLen, pos + matchLen + CONTEXT_AFTER);

    if (looksLikeNonPrice(contextBefore, contextAfter)) continue;

    const key = `${currency}:${value}:${pos}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      rawText: m[0] ?? numRaw,
      value,
      currency,
      contextBefore: contextBefore.replace(/\s+/g, ' ').trim(),
      contextAfter: contextAfter.replace(/\s+/g, ' ').trim(),
      source: opts.source ?? 'text',
      confidence: 0,
      reason: '',
    });
  }

  return out;
}

/**
 * Atribui confiança/razão a cada candidato a partir do contexto.
 * Base 50; sinais principais sobem, contextos de parcela/frete/desconto descem.
 */
export function scorePriceCandidate(c: PriceCandidate): PriceCandidate {
  let score = 50;
  const reasons: string[] = [];

  for (const sig of NON_PRINCIPAL_BEFORE) {
    if (sig.rx.test(c.contextBefore)) {
      score -= sig.penalty;
      reasons.push(`-${sig.penalty} ${sig.reason}`);
    }
  }
  for (const sig of NON_PRINCIPAL_AFTER) {
    if (sig.rx.test(c.contextAfter)) {
      score -= sig.penalty;
      reasons.push(`-${sig.penalty} ${sig.reason}`);
    }
  }
  for (const sig of PRINCIPAL_SIGNALS) {
    if (sig.rx.test(c.contextBefore) || sig.rx.test(c.contextAfter)) {
      score += sig.bonus;
      reasons.push(`+${sig.bonus} ${sig.reason}`);
    }
  }

  const confidence = Math.max(0, Math.min(100, score));
  return { ...c, confidence, reason: reasons.join(' · ') || 'preço sem sinais especiais' };
}

/**
 * Ranqueia candidatos: maior confiança primeiro. Em empate, o MENOR valor
 * vence (evita que o "de R$ X" antigo/maior ganhe do preço à vista).
 */
export function rankPriceCandidates(cands: PriceCandidate[]): PriceCandidate[] {
  return cands
    .map(scorePriceCandidate)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.value - b.value;
    });
}

/**
 * Escolhe o preço principal do texto. Retorna null se nenhum candidato
 * passar de uma confiança mínima (default 25) — não chuta.
 */
export function pickPrincipalPrice(
  text: string,
  opts: FindPriceCandidatesOptions & { minConfidence?: number } = {},
): PriceCandidate | null {
  const ranked = rankPriceCandidates(findPriceCandidates(text, opts));
  const min = opts.minConfidence ?? 25;
  const best = ranked[0];
  if (!best || best.confidence < min) return null;
  return best;
}

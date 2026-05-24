/**
 * Parser monetário robusto e compartilhado pelos extractors locais V2.
 *
 * Resolve dois problemas distintos:
 *  1. Detectar a MOEDA a partir de um símbolo/código (R$, US$, $, €, ¥, BRL…).
 *  2. Converter a string numérica em número, lidando com formato brasileiro
 *     (1.299,90 → milhar '.', decimal ',') vs americano (1,299.90 → milhar ',',
 *     decimal '.').
 *
 * Função PURA — não toca rede, DB nem IA. Nunca inventa valor: entrada
 * inválida retorna null.
 *
 * Casos cobertos:
 *   R$ 1.299,90   BRL 1299.90   US$ 199.99   USD 199.99   $199.99
 *   € 99,90       EUR 99.90     ¥ 500        CNY 500      RMB 500
 */

export type SupportedCurrency = 'BRL' | 'USD' | 'EUR' | 'CNY';

/** Símbolos/códigos reconhecidos, em ordem de prioridade (mais específico primeiro). */
const CURRENCY_TOKENS: Array<{ rx: RegExp; currency: SupportedCurrency }> = [
  { rx: /R\$/i, currency: 'BRL' },
  { rx: /US\$/i, currency: 'USD' },
  { rx: /\bBRL\b/i, currency: 'BRL' },
  { rx: /\bUSD\b/i, currency: 'USD' },
  { rx: /\bRMB\b/i, currency: 'CNY' },
  { rx: /\bCNY\b/i, currency: 'CNY' },
  { rx: /\bEUR\b/i, currency: 'EUR' },
  { rx: /€/, currency: 'EUR' },
  { rx: /¥/, currency: 'CNY' },
  { rx: /\$/, currency: 'USD' }, // '$' isolado → assume USD (menor prioridade)
];

/** Moedas cujo separador decimal é a vírgula (milhar = ponto). */
const COMMA_DECIMAL = new Set<SupportedCurrency>(['BRL', 'EUR']);

/**
 * Detecta a moeda a partir de um trecho que contém o símbolo/código.
 * Retorna null se nenhum token monetário for reconhecido.
 */
export function detectCurrency(token: string): SupportedCurrency | null {
  for (const t of CURRENCY_TOKENS) {
    if (t.rx.test(token)) return t.currency;
  }
  return null;
}

/**
 * Converte a parte numérica de um preço em número.
 *
 * `currency` orienta a heurística de separador:
 *   - BRL/EUR → vírgula é decimal, ponto é milhar.
 *   - USD/CNY → ponto é decimal, vírgula é milhar.
 *   - undefined → infere pelo separador mais à direita (último = decimal).
 */
export function parseAmount(
  raw: string,
  currency?: SupportedCurrency | null,
): number | null {
  const s0 = raw.replace(/[^\d.,]/g, '');
  if (!s0 || !/\d/.test(s0)) return null;

  const hasDot = s0.includes('.');
  const hasComma = s0.includes(',');
  const commaDecimal = currency ? COMMA_DECIMAL.has(currency) : null;

  let normalized = s0;

  if (hasDot && hasComma) {
    // Ambos presentes: o separador MAIS À DIREITA é o decimal.
    const lastIsComma = s0.lastIndexOf(',') > s0.lastIndexOf('.');
    normalized = lastIsComma
      ? s0.replace(/\./g, '').replace(',', '.')
      : s0.replace(/,/g, '');
  } else if (hasComma) {
    const decimals = s0.length - s0.lastIndexOf(',') - 1;
    if (commaDecimal === true) {
      normalized = s0.replace(/\./g, '').replace(',', '.');
    } else if (commaDecimal === false) {
      normalized = s0.replace(/,/g, ''); // vírgula = milhar
    } else {
      // Sem moeda conhecida: 2 casas → decimal; 3 casas → milhar.
      normalized = decimals === 2 ? s0.replace(',', '.') : s0.replace(/,/g, '');
    }
  } else if (hasDot) {
    const decimals = s0.length - s0.lastIndexOf('.') - 1;
    const single = (s0.match(/\./g) ?? []).length === 1;
    if (commaDecimal === true) {
      // BRL/EUR: ponto é milhar — salvo "189.90" (decimal de 2 casas vindo de markdown).
      normalized = single && decimals === 2 ? s0 : s0.replace(/\./g, '');
    } else if (commaDecimal === false) {
      normalized = s0; // ponto é decimal
    } else {
      // Sem moeda: ".299" de 3 casas e grupo único → milhar; senão decimal.
      normalized = single && decimals === 3 ? s0.replace(/\./g, '') : s0;
    }
  }

  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedMoney {
  value: number;
  currency: SupportedCurrency | null;
}

/**
 * Lê uma string monetária completa (ex: "R$ 1.299,90") e devolve valor + moeda.
 * `defaultCurrency` é usado quando nenhum símbolo é encontrado no texto.
 */
export function parseMoney(
  raw: string,
  opts: { defaultCurrency?: SupportedCurrency } = {},
): ParsedMoney | null {
  const currency = detectCurrency(raw) ?? opts.defaultCurrency ?? null;
  const value = parseAmount(raw, currency);
  if (value === null) return null;
  return { value, currency };
}

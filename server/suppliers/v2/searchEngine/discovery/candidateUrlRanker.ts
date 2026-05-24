/**
 * candidateUrlRanker — pontua e ordena URLs candidatas de produto (Etapa 6).
 *
 * Pontuação 0–100:
 *   Base (por classe de link via linkClassifier):
 *     product  → 50
 *     unknown  → 20
 *     search   → 5  (só aparece em diagnostics; não entra nos candidatos finais)
 *     category → 5  (idem)
 *     home/cart/login/checkout → 0 (já filtrados no extractor)
 *   Bônus:
 *     +até 25 — tokens da query presentes na URL (8 pts/token, máx 25)
 *     +15     — mesmo domínio do fornecedor
 *     +10     — profundidade do path entre 2 e 5 segmentos
 *
 * Apenas links classificados como 'product' ou 'unknown' entram nos candidatos
 * finais. Links 'search' ou 'category' não são produto final (regra Etapa 6).
 *
 * Funções PURAS.
 */
import { classifyUrl } from '../../extractors/linkClassifier.js';
import type { LinkClass } from '../../extractors/linkClassifier.js';
import type { ExtractedUrl } from './candidateUrlExtractor.js';
import type { RankedCandidate } from './discoveryTypes.js';

const BASE_SCORES: Record<LinkClass, number> = {
  product: 50,
  unknown: 20,
  search: 5,
  category: 5,
  home: 0,
  cart: 0,
  login: 0,
  checkout: 0,
};

/**
 * Divide a query em tokens normalizados (min 2 chars, sem diacríticos).
 * Exported para uso em testes e em productUrlDiscovery.
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\W+/)
    .filter((t) => t.length >= 2);
}

function pathDepthScore(url: string): number {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const d = segments.length;
    if (d >= 2 && d <= 5) return 10;
    if (d === 1) return 5;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Pontua uma única URL. Retorna score, classe, contagem de tokens e razão
 * textual. Pode pontuar qualquer classe (incluindo search/category) para uso
 * em diagnostics — a filtragem acontece em rankCandidates.
 */
export function scoreCandidateUrl(
  url: string,
  query: string,
  supplierDomain?: string,
): { score: number; linkClass: LinkClass; queryTokensFound: number; reason: string } {
  const classification = classifyUrl(url);
  const linkClass = classification.type;
  let score = BASE_SCORES[linkClass] ?? 0;
  let reason = classification.reason;

  // Bônus por tokens da query presentes na URL decodificada
  const tokens = tokenizeQuery(query);
  const urlDecoded = decodeURIComponent(url).toLowerCase();
  const found = tokens.filter((t) => urlDecoded.includes(t));
  const tokenBonus = Math.min(found.length * 8, 25);
  score += tokenBonus;
  if (found.length > 0) {
    reason += `; ${found.length} query token(s) na URL`;
  }

  // Bônus por mesmo domínio do fornecedor
  if (supplierDomain) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const normalized = host.startsWith('www.') ? host.slice(4) : host;
      if (normalized === supplierDomain || normalized.endsWith(`.${supplierDomain}`)) {
        score += 15;
        reason += '; mesmo domínio';
      }
    } catch {
      // sem bônus
    }
  }

  // Bônus por profundidade do path
  score += pathDepthScore(url);

  return { score, linkClass, queryTokensFound: found.length, reason };
}

/**
 * Pontua e ordena os candidatos. Retorna apenas URLs classificadas como
 * 'product' ou 'unknown', do maior para menor score.
 */
export function rankCandidates(
  extractedUrls: ExtractedUrl[],
  query: string,
  supplierDomain?: string,
  maxCandidates = 10,
): RankedCandidate[] {
  return extractedUrls
    .map((eu) => {
      const { score, linkClass, queryTokensFound, reason } = scoreCandidateUrl(
        eu.url,
        query,
        supplierDomain,
      );
      return { url: eu.url, score, linkClass, reason, queryTokensFound };
    })
    .filter((c) => c.linkClass === 'product' || c.linkClass === 'unknown')
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
}

/**
 * Ranqueamento de resultados de busca.
 *
 * Critérios (em ordem de prioridade):
 *   1. Resultado encontrado (sem error_message) → vem primeiro
 *   2. Menor total_brl
 *   3. Maior match_score (combina com a query do usuário)
 *   4. Maior confidence (qualidade da extração)
 *   5. Link direto de produto vence link de busca
 *
 * Também responsável por escolher o "best" da busca (top 1 entre válidos).
 */

export interface RankableResult {
  total_brl?: number | null;
  match_score?: number | null;
  confidence?: number | null;
  product_url?: string | null;
  error_message?: string | null;
}

const PRODUCT_URL_PATTERNS = [
  /\/MLB\d{5,}/,
  /\/dp\/[A-Z0-9]{8,}/,
  /-i\.\d{5,}\.\d{5,}/,
  /\/p\/[a-z0-9]{8,}[\/.]/i,
  /\/item\/\d{8,}/,
  /\/product[-_]detail\//i,
];

function isProductUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return PRODUCT_URL_PATTERNS.some((p) => p.test(url));
}

export const rankingService = {
  /**
   * Ordena resultados por melhor valor (preço + qualidade).
   * Resultados com erro vão pro fim (mas não são removidos).
   */
  sortByBestValue<T extends RankableResult>(results: T[]): T[] {
    return [...results].sort((a, b) => {
      // 1. Resultados sem erro primeiro
      const aOk = !a.error_message;
      const bOk = !b.error_message;
      if (aOk !== bOk) return aOk ? -1 : 1;

      // 2. Menor total_brl
      const aPrice = a.total_brl ?? Infinity;
      const bPrice = b.total_brl ?? Infinity;
      if (aPrice !== bPrice) return aPrice - bPrice;

      // 3. Maior match_score
      const aMatch = a.match_score ?? 0;
      const bMatch = b.match_score ?? 0;
      if (aMatch !== bMatch) return bMatch - aMatch;

      // 4. Maior confidence
      const aConf = a.confidence ?? 0;
      const bConf = b.confidence ?? 0;
      if (aConf !== bConf) return bConf - aConf;

      // 5. Link direto vence link de busca
      const aDirect = isProductUrl(a.product_url) ? 1 : 0;
      const bDirect = isProductUrl(b.product_url) ? 1 : 0;
      return bDirect - aDirect;
    });
  },

  /**
   * Escolhe o "melhor" resultado entre os encontrados.
   * Retorna null se nenhum resultado válido.
   */
  best<T extends RankableResult>(results: T[]): T | null {
    const sorted = this.sortByBestValue(results.filter((r) => !r.error_message && r.total_brl !== null && r.total_brl !== undefined));
    return sorted[0] ?? null;
  },
};

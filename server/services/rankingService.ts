/**
 * Ranqueamento de resultados.
 *
 * Critérios (em ordem de prioridade):
 *  1. Menor preço total em BRL (preço + frete)
 *  2. Maior confidence (qualidade da extração)
 *  3. Mais reviews
 *  4. Link direto de produto vs página de busca
 */

export interface RankableResult {
  found: boolean;
  price_brl?: number | null;
  total_brl?: number | null;
  confidence?: number | null;
  product_reviews?: number | null;
  link_type?: string | null;
}

export const rankingService = {
  sortByBestValue<T extends RankableResult>(results: T[]): T[] {
    return [...results]
      .filter((r) => r.found)
      .sort((a, b) => {
        const aPrice = a.total_brl ?? a.price_brl ?? Infinity;
        const bPrice = b.total_brl ?? b.price_brl ?? Infinity;
        if (aPrice !== bPrice) return aPrice - bPrice;

        const aConf = a.confidence ?? 0;
        const bConf = b.confidence ?? 0;
        if (aConf !== bConf) return bConf - aConf;

        const aRev = a.product_reviews ?? 0;
        const bRev = b.product_reviews ?? 0;
        if (aRev !== bRev) return bRev - aRev;

        const aLink = a.link_type === 'product' ? 1 : 0;
        const bLink = b.link_type === 'product' ? 1 : 0;
        return bLink - aLink;
      });
  },

  bestResult<T extends RankableResult>(results: T[]): T | null {
    const sorted = this.sortByBestValue(results);
    return sorted[0] ?? null;
  },
};

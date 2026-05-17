/**
 * Ranqueamento de resultados de busca.
 *
 * Critérios (em ordem de prioridade):
 *   1. Resultado sem erro primeiro
 *   2. Link de produto validado antes de link de busca
 *   3. Menor total_brl
 *   4. Produto disponível antes de indisponível
 *   5. Resultado mais recente (tiebreaker)
 *
 * confidence/match_score continuam no banco para validação interna mas
 * não influenciam o ranking público nem aparecem na UI.
 */

export interface RankableResult {
  total_brl?: number | null;
  product_url?: string | null;
  link_type?: 'product' | 'search' | 'unverified' | null;
  link_validated?: boolean | null;
  available?: boolean | null;
  error_message?: string | null;
  collected_at?: string | null;
}

const PRODUCT_URL_PATTERNS = [
  /\/MLB\d{5,}/,
  /\/dp\/[A-Z0-9]{8,}/,
  /-i\.\d{5,}\.\d{5,}/,
  /\/p\/[a-z0-9]{8,}[\/.]/i,
  /\/item\/\d{8,}/,
  /\/product[-_]detail\//i,
];

function hasValidatedProductLink(r: RankableResult): boolean {
  if (r.link_type === 'product' && r.link_validated === true) return true;
  // Fallback: sem link_type explícito mas URL bate com padrão conhecido
  if (!r.link_type && r.product_url) {
    return PRODUCT_URL_PATTERNS.some((p) => p.test(r.product_url!));
  }
  return false;
}

export const rankingService = {
  sortByBestValue<T extends RankableResult>(results: T[]): T[] {
    return [...results].sort((a, b) => {
      // 1. Sem erro vence
      const aOk = !a.error_message;
      const bOk = !b.error_message;
      if (aOk !== bOk) return aOk ? -1 : 1;

      // 2. Link de produto validado vence link de busca
      const aProd = hasValidatedProductLink(a) ? 1 : 0;
      const bProd = hasValidatedProductLink(b) ? 1 : 0;
      if (aProd !== bProd) return bProd - aProd;

      // 3. Menor total_brl
      const aPrice = a.total_brl ?? Infinity;
      const bPrice = b.total_brl ?? Infinity;
      if (aPrice !== bPrice) return aPrice - bPrice;

      // 4. Disponível vence indisponível
      const aAvail = a.available === false ? 0 : 1;
      const bAvail = b.available === false ? 0 : 1;
      if (aAvail !== bAvail) return bAvail - aAvail;

      // 5. Mais recente
      const aTime = a.collected_at ? new Date(a.collected_at).getTime() : 0;
      const bTime = b.collected_at ? new Date(b.collected_at).getTime() : 0;
      return bTime - aTime;
    });
  },

  best<T extends RankableResult>(results: T[]): T | null {
    const sorted = this.sortByBestValue(
      results.filter((r) => !r.error_message && r.total_brl !== null && r.total_brl !== undefined),
    );
    return sorted[0] ?? null;
  },
};

/**
 * matchingService — calcula quão bem o nome do produto retornado pelo scraper
 * casa com a query do usuário.
 *
 * Retorna 0-100. Usado para:
 *  - Validar se vale a pena salvar o resultado (match_score baixo → warning)
 *  - Ordenar resultados quando preços são próximos
 *  - Detectar resultados claramente errados ("capinha" quando buscou "iphone")
 *
 * Algoritmo (simples mas robusto):
 *  1. Normaliza ambas strings (lowercase, sem acento, sem pontuação)
 *  2. Tokeniza
 *  3. Conta tokens da query que aparecem no produto (exato ou substring)
 *  4. Bônus por substring contígua exata
 *  5. Penalidade se o produto for muito mais "estreito" (pode ser acessório)
 */

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'e', 'de', 'do', 'da', 'dos', 'das',
  'para', 'com', 'sem', 'em', 'no', 'na', 'nos', 'nas', 'por',
]);

const ACCESSORY_HINTS = [
  'capinha', 'capa', 'case', 'película', 'pelicula', 'protetor',
  'cabo usb', 'cabo lightning', 'cabo', 'carregador', 'fonte',
  'adaptador', 'suporte', 'bateria extra', 'compatível', 'compativel',
  'para iphone', 'para samsung', 'para xiaomi', 'genérico', 'generico',
  'similar', 'replica', 'réplica',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export interface MatchResult {
  score: number;       // 0-100
  matchedTokens: number;
  totalTokens: number;
  containsExactQuery: boolean;
  isLikelyAccessory: boolean;
}

export const matchingService = {
  /**
   * Calcula o score de match entre a query do usuário e o nome do produto
   * retornado pelo scraper.
   */
  score(query: string, productName: string): MatchResult {
    if (!query || !productName) {
      return {
        score: 0,
        matchedTokens: 0,
        totalTokens: 0,
        containsExactQuery: false,
        isLikelyAccessory: false,
      };
    }

    const qNorm = normalize(query);
    const pNorm = normalize(productName);
    const qTokens = tokenize(query);
    const pTokens = new Set(tokenize(productName));

    if (qTokens.length === 0) {
      return {
        score: 0,
        matchedTokens: 0,
        totalTokens: 0,
        containsExactQuery: false,
        isLikelyAccessory: false,
      };
    }

    // Conta matches: 1.0 exato, 0.5 substring (ex: "128gb" casa com "128")
    let matched = 0;
    for (const t of qTokens) {
      if (pTokens.has(t)) {
        matched += 1;
        continue;
      }
      const partial = Array.from(pTokens).some(
        (pt) => (pt.length >= 3 && (pt.includes(t) || t.includes(pt))),
      );
      if (partial) matched += 0.5;
    }

    let score = (matched / qTokens.length) * 100;

    // Bônus: substring exata da query no produto
    const containsExactQuery = pNorm.includes(qNorm);
    if (containsExactQuery) score = Math.min(100, score + 10);

    // Detecta acessório
    const isLikelyAccessory = ACCESSORY_HINTS.some((hint) => pNorm.includes(hint));
    // Se a query NÃO menciona acessório mas o produto SIM, pesado penalty
    const queryAsksAccessory = ACCESSORY_HINTS.some((hint) => qNorm.includes(hint));
    if (isLikelyAccessory && !queryAsksAccessory) {
      score = Math.max(0, score - 35);
    }

    return {
      score: Math.round(Math.max(0, Math.min(100, score))),
      matchedTokens: Math.round(matched * 100) / 100,
      totalTokens: qTokens.length,
      containsExactQuery,
      isLikelyAccessory: isLikelyAccessory && !queryAsksAccessory,
    };
  },

  /**
   * Chave normalizada para cache (mesma query semântica → mesma chave).
   */
  cacheKey(query: string): string {
    return normalize(query);
  },
};

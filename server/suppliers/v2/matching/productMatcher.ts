/**
 * Matching simples interno do V2.
 *
 * NÃO substitui `server/services/matchingService.ts` — é uma versão
 * mínima e auto-contida para o Recipe Runner usar até a fase em que o
 * matching unificado for tratado.
 *
 * Lógica:
 *  - Normaliza (lowercase, remove acentos, mantém alfanum/espaço)
 *  - Tokeniza por espaço, descarta stopwords e tokens curtos
 *  - Calcula score 0–100 = (intersecção / |query_tokens|) * 100
 *  - Penaliza acessórios: se o nome contém "capinha/capa/película/case/cover"
 *    e a query NÃO contém esses termos, marca `isAccessory=true`.
 *
 * Função PURA — não toca rede ou DB.
 */

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos',
  'a', 'o', 'as', 'os', 'um', 'uma',
  'e', 'ou', 'para', 'por', 'com', 'sem',
  'em', 'no', 'na', 'nos', 'nas',
  'the', 'and', 'or', 'for', 'of', 'with',
]);

const ACCESSORY_TERMS = [
  'capinha',
  'capa',
  'pelicula',
  'película',
  'carregador',
  'case',
  'cover',
  'screen protector',
  'suporte',
  'cabo',
];

export interface MatchResult {
  score: number; // 0–100
  isAccessory: boolean;
  reasons: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function queryAsksForAccessory(queryNorm: string): boolean {
  return ACCESSORY_TERMS.some((term) =>
    queryNorm.includes(normalize(term)),
  );
}

function productLooksLikeAccessory(productNorm: string): boolean {
  return ACCESSORY_TERMS.some((term) =>
    productNorm.includes(normalize(term)),
  );
}

export function matchProduct(query: string, productName: string): MatchResult {
  const reasons: string[] = [];
  const queryNorm = normalize(query);
  const productNorm = normalize(productName);

  const queryTokens = tokenize(query);
  const productTokens = new Set(tokenize(productName));

  if (queryTokens.length === 0) {
    return { score: 0, isAccessory: false, reasons: ['empty query'] };
  }

  let hits = 0;
  for (const t of queryTokens) {
    if (productTokens.has(t)) {
      hits++;
    }
  }
  const score = Math.round((hits / queryTokens.length) * 100);

  const queryWantsAccessory = queryAsksForAccessory(queryNorm);
  const productIsAccessory = productLooksLikeAccessory(productNorm);
  const isAccessory = productIsAccessory && !queryWantsAccessory;

  if (isAccessory) {
    reasons.push('product looks like accessory but query does not ask for it');
  }
  reasons.push(`token overlap ${hits}/${queryTokens.length}`);

  return { score, isAccessory, reasons };
}

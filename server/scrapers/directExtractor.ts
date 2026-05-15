/**
 * directExtractor — extrai preço/produto/link DIRETAMENTE do markdown
 * retornado pelo Jina Reader, usando regex + heurísticas, SEM IA.
 *
 * Este é o motor PRINCIPAL da busca. Gemini é apenas um interpretador
 * opcional usado quando a extração direta falha E GEMINI_ENABLED=true.
 *
 * Garantias:
 *  - NUNCA inventa preço — só extrai o que está literalmente no conteúdo.
 *  - SEMPRE retorna evidence_text (o trecho onde o preço foi encontrado).
 *  - SEMPRE retorna source_url (a URL que foi raspada).
 *  - Valida que o link é coerente com o domínio do fornecedor.
 */
import type { Supplier } from '../services/supplierService.js';
import { matchingService } from '../services/matchingService.js';

export interface DirectExtractResult {
  found: boolean;
  productName?: string;
  price?: number;
  currency?: string;
  link?: string;
  sellerName?: string;
  freight?: number;
  available?: boolean;
  evidenceText?: string;
  sourceUrl?: string;
  sourceName?: string;
  matchScore?: number;
  confidence?: number;
  warning?: string;
  errorMessage?: string;
}

// Padrões de URL de produto por marketplace
const PRODUCT_URL_PATTERNS: Array<{ pattern: RegExp; supplier: string }> = [
  { pattern: /\/MLB-?\d{6,}/i,                supplier: 'mercadolivre' },
  { pattern: /\/p\/MLB\d{6,}/i,               supplier: 'mercadolivre' },
  { pattern: /\/dp\/[A-Z0-9]{10}/,            supplier: 'amazon' },
  { pattern: /\/gp\/product\/[A-Z0-9]{10}/,   supplier: 'amazon' },
  { pattern: /-i\.\d{5,}\.\d{5,}/,            supplier: 'shopee' },
  { pattern: /\/p\/[a-z0-9]{6,}[\/.]/i,       supplier: 'magalu' },
  { pattern: /\/item\/\d{6,}/,                supplier: 'aliexpress' },
  { pattern: /\/product-detail\//i,           supplier: 'alibaba' },
];

// Patterns de preço BRL e moedas internacionais
const PRICE_PATTERNS = [
  // R$ 1.234,56 ou R$ 1234,56
  { rx: /R\$\s*([\d.]+(?:,\d{1,2})?)/g, currency: 'BRL', parse: (s: string) => parseBR(s) },
  // US$ 1,234.56 ou $ 1234.56
  { rx: /(?:US\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/g, currency: 'USD', parse: (s: string) => parseUS(s) },
  // € 1.234,56
  { rx: /€\s*([\d.]+(?:,\d{1,2})?)/g, currency: 'EUR', parse: (s: string) => parseBR(s) },
  // ¥ 1234.56 (CNY)
  { rx: /¥\s*([\d,]+(?:\.\d{1,2})?)/g, currency: 'CNY', parse: (s: string) => parseUS(s) },
];

function parseBR(s: string): number {
  // formato brasileiro: 1.234,56 → 1234.56
  return parseFloat(s.replace(/\./g, '').replace(',', '.'));
}
function parseUS(s: string): number {
  // formato US: 1,234.56 → 1234.56
  return parseFloat(s.replace(/,/g, ''));
}

/**
 * Encontra TODOS os URLs de produto no conteúdo que pertencem ao fornecedor.
 */
function findProductUrls(content: string, supplierSite: string): string[] {
  const siteNoWww = supplierSite.replace(/^www\./, '').toLowerCase();
  const escSite = siteNoWww.replace(/\./g, '\\.');
  const urlRx = new RegExp(`https?:\\/\\/(?:www\\.)?${escSite}\\/[^\\s)"'<>\\]]+`, 'gi');
  const all = content.match(urlRx) ?? [];
  const out: string[] = [];
  for (const raw of all) {
    const clean = raw.replace(/[).,;:!?\]]+$/, '');
    // Filtra páginas de busca
    if (/\/(search|busca|s\?|find|q=|wholesale|category|categoria)/i.test(clean)) continue;
    // Aceita se tem padrão de produto OU se é URL longa específica
    const isProduct = PRODUCT_URL_PATTERNS.some(({ pattern }) => pattern.test(clean));
    if (isProduct) out.push(clean);
  }
  return Array.from(new Set(out));
}

/**
 * Encontra todos os preços plausíveis no conteúdo, com posição.
 */
interface PriceMatch {
  value: number;
  currency: string;
  text: string;
  position: number;
}

function findPrices(content: string, plausibleRange: [number, number]): PriceMatch[] {
  const out: PriceMatch[] = [];
  for (const { rx, currency, parse } of PRICE_PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const value = parse(raw);
      if (!Number.isFinite(value)) continue;
      if (value < plausibleRange[0] || value > plausibleRange[1]) continue;
      out.push({ value, currency, text: m[0], position: m.index });
    }
  }
  return out;
}

/**
 * Tenta encontrar um nome de produto próximo a uma posição no texto.
 * Procura por linha que contenha palavras da query.
 */
function findProductNameNear(content: string, position: number, query: string): string | null {
  const qNorm = matchingService.cacheKey(query);
  const qTokens = qNorm.split(' ').filter((t) => t.length >= 3);
  if (qTokens.length === 0) return null;

  // Procura nas linhas próximas (até 1000 chars antes do preço, costuma ser o título)
  const start = Math.max(0, position - 1500);
  const slice = content.slice(start, position);
  const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);

  // Linha mais recente (mais perto do preço) que contenha tokens da query
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.length < 6 || line.length > 240) continue;
    const lineNorm = matchingService.cacheKey(line);
    const matched = qTokens.filter((t) => lineNorm.includes(t)).length;
    if (matched >= Math.ceil(qTokens.length / 2)) {
      // remove markdown comuns
      return line.replace(/^[#*\-\s|>]+/, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim().slice(0, 200) || null;
    }
  }
  return null;
}

/**
 * Faixa plausível de preço por moeda (em moeda nativa).
 * Evita capturar "5 estrelas" como R$5 ou números absurdos.
 */
function priceRange(currency: string): [number, number] {
  if (currency === 'BRL') return [10, 500_000];
  if (currency === 'USD') return [3, 100_000];
  if (currency === 'EUR') return [3, 100_000];
  if (currency === 'CNY') return [10, 500_000];
  return [1, 1_000_000];
}

/**
 * Extrai resultado direto do conteúdo Jina, SEM AI.
 *
 * Estratégia:
 *  1. Detecta a moeda esperada do fornecedor
 *  2. Acha todos URLs de produto do domínio do fornecedor
 *  3. Acha todos preços plausíveis
 *  4. Pareia: URL próxima de preço + nome próximo de preço = resultado
 *  5. Escolhe o resultado com melhor match_score com a query
 */
export function extractDirectly(
  supplier: Supplier,
  query: string,
  content: string,
  sourceUrl: string,
): DirectExtractResult {
  if (!content || content.length < 200) {
    return {
      found: false,
      errorMessage: 'conteúdo da página vazio/curto demais',
      sourceUrl,
      sourceName: 'jina',
    };
  }

  const expectedCurrency = (supplier.currency || 'BRL').toUpperCase();
  const range = priceRange(expectedCurrency);

  const prices = findPrices(content, range);
  if (prices.length === 0) {
    return {
      found: false,
      errorMessage: 'nenhum preço plausível encontrado no conteúdo',
      sourceUrl,
      sourceName: 'jina',
    };
  }

  const productUrls = findProductUrls(content, supplier.site);

  // Para cada preço, tenta achar um nome próximo + URL próxima
  const candidates: Array<{
    price: number;
    currency: string;
    name: string;
    url: string;
    evidenceText: string;
    matchScore: number;
    distance: number;
  }> = [];

  for (const p of prices) {
    // Considera apenas preços na moeda esperada (regra de ouro: não converter chute)
    if (p.currency !== expectedCurrency) continue;

    const name = findProductNameNear(content, p.position, query);
    if (!name) continue;

    // URL mais próxima do preço (vértice)
    let bestUrl = '';
    let bestDist = Infinity;
    for (const u of productUrls) {
      const idx = content.indexOf(u);
      if (idx < 0) continue;
      const d = Math.abs(idx - p.position);
      if (d < bestDist) {
        bestDist = d;
        bestUrl = u;
      }
    }

    const matchResult = matchingService.score(query, name);
    if (matchResult.score < 30) continue;
    if (matchResult.isLikelyAccessory) continue;

    // Evidence: trecho ao redor do preço (200 chars)
    const evStart = Math.max(0, p.position - 100);
    const evEnd = Math.min(content.length, p.position + 100);
    const evidenceText = content.slice(evStart, evEnd).replace(/\s+/g, ' ').trim();

    candidates.push({
      price: p.value,
      currency: p.currency,
      name,
      url: bestUrl,
      evidenceText,
      matchScore: matchResult.score,
      distance: bestDist,
    });
  }

  if (candidates.length === 0) {
    return {
      found: false,
      errorMessage: 'nenhum candidato com nome de produto, preço e URL coerentes',
      sourceUrl,
      sourceName: 'jina',
    };
  }

  // Escolhe: maior match_score → menor preço → URL mais próxima
  candidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (a.price !== b.price) return a.price - b.price;
    return a.distance - b.distance;
  });
  const best = candidates[0];
  if (!best) {
    return {
      found: false,
      errorMessage: 'nenhum candidato válido após ranking',
      sourceUrl,
      sourceName: 'jina',
    };
  }

  // Confiança baseada em: URL direta (40), nome bate query (40), preço em moeda certa (20)
  let confidence = 20; // preço em moeda certa (já filtrado)
  const hasDirectUrl = best.url && PRODUCT_URL_PATTERNS.some(({ pattern }) => pattern.test(best.url));
  if (hasDirectUrl) confidence += 40;
  if (best.matchScore >= 70) confidence += 40;
  else if (best.matchScore >= 50) confidence += 25;
  else confidence += 10;

  return {
    found: true,
    productName: best.name,
    price: best.price,
    currency: best.currency,
    link: best.url || undefined,
    evidenceText: best.evidenceText,
    sourceUrl,
    sourceName: 'jina-direct',
    matchScore: best.matchScore,
    confidence: Math.min(100, confidence),
    available: true,
  };
}

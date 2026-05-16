/**
 * directExtractor — Motor Universal de Extração de Produtos.
 *
 * Extrai candidatos de produto a partir de QUALQUER conteúdo (HTML cru,
 * markdown Jina, JSON embedded), SEM depender de API de IA.
 *
 * Estratégias internas (executadas em cascata; melhor candidato vence):
 *   1. JSON-LD schema.org Product (`<script type="application/ld+json">`)
 *   2. __NEXT_DATA__ e outros scripts JSON embutidos
 *   3. Markdown/texto visível com regex de preço + URL + nome
 *
 * Garantias:
 *  - NUNCA inventa preço — só extrai o que está literalmente no conteúdo.
 *  - SEMPRE retorna evidence_text (trecho onde o preço foi encontrado).
 *  - SEMPRE retorna source_url (URL que foi raspada).
 *  - Valida domínio do link e descarta acessórios não solicitados.
 *  - Detecta frete grátis vs frete real vs frete não encontrado.
 *  - Rejeita números que não são preço (avaliação, capacidade GB/MB, parcelas, ano).
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
  freightNote?: string;
  available?: boolean;
  evidenceText?: string;
  sourceUrl?: string;
  sourceName?: string;
  matchScore?: number;
  confidence?: number;
  warning?: string;
  errorMessage?: string;
}

const PRODUCT_URL_PATTERNS: RegExp[] = [
  /\/MLB-?\d{6,}/i,
  /\/p\/MLB\d{6,}/i,
  /\/dp\/[A-Z0-9]{10}/,
  /\/gp\/product\/[A-Z0-9]{10}/,
  /-i\.\d{5,}\.\d{5,}/,
  /\/p\/[a-z0-9]{6,}[\/.]/i,
  /\/item\/\d{6,}/,
  /\/product-detail\//i,
  /\/produto\//i,
  /\/products\/[^/]+/i,
];

const PRICE_PATTERNS = [
  // BRL — R$ 1.234,56 ou R$ 1234,56 ou R$ 1234.56
  { rx: /R\$\s*([\d.]+(?:,\d{1,2})?)/g, currency: 'BRL', parse: parseBR },
  // USD — US$ 1,234.56 / USD 123.45 / $ 1234.56
  { rx: /(?:US\$|USD)\s*([\d,]+(?:\.\d{1,2})?)/g, currency: 'USD', parse: parseUS },
  { rx: /\$\s*([\d,]+\.\d{1,2})/g, currency: 'USD', parse: parseUS },
  // EUR — € 1.234,56 / EUR 123,45
  { rx: /€\s*([\d.]+(?:,\d{1,2})?)/g, currency: 'EUR', parse: parseBR },
  { rx: /EUR\s*([\d.]+(?:,\d{1,2})?)/g, currency: 'EUR', parse: parseBR },
  // CNY — ¥ 1234.56 / CNY 123.45
  { rx: /¥\s*([\d,]+(?:\.\d{1,2})?)/g, currency: 'CNY', parse: parseUS },
  { rx: /CNY\s*([\d,]+(?:\.\d{1,2})?)/g, currency: 'CNY', parse: parseUS },
] as const;

function parseBR(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.'));
}
function parseUS(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

function priceRange(currency: string): [number, number] {
  if (currency === 'BRL') return [5, 500_000];
  if (currency === 'USD') return [1, 100_000];
  if (currency === 'EUR') return [1, 100_000];
  if (currency === 'CNY') return [3, 500_000];
  return [1, 1_000_000];
}

interface PriceMatch {
  value: number;
  currency: string;
  text: string;
  position: number;
}

/**
 * Rejeita números que aparecem em contextos não-preço (avaliação, GB, ano, parcelas).
 * Olha 60 chars antes e 30 chars depois do match.
 */
function looksLikeNonPrice(content: string, position: number, matchText: string): boolean {
  const before = content.slice(Math.max(0, position - 60), position).toLowerCase();
  const after = content.slice(position + matchText.length, Math.min(content.length, position + matchText.length + 30)).toLowerCase();

  // Avaliação / estrelas / reviews
  if (/\b(avalia[cç][aã]o|review|nota|estrelas?|rating)\b[^\d]{0,8}$/i.test(before)) return true;
  if (/^\s*(estrelas?|de\s+5|avalia[cç][oõ]es|reviews?)/i.test(after)) return true;
  // Vendidos / unidades vendidas
  if (/^\s*(vendidos?|unidades?\s+vendidas?|sold)/i.test(after)) return true;
  // Capacidade / medida (mas só se logo após o número, sem R$/US$/€/¥ no match — esses já vêm com símbolo)
  if (/^\s*(gb|mb|tb|kb|mm|cm|kg|g|ml|l|w|v|hz|fps|polegadas|inch|ano|year)\b/i.test(after)) return true;
  // Parcelas — "12x" antes não é preço
  if (/\d+\s*x\s*$/i.test(before)) return true;
  return false;
}

function findPrices(content: string, plausibleRange: [number, number], expectedCurrency: string): PriceMatch[] {
  const out: PriceMatch[] = [];
  const seen = new Set<string>();
  for (const { rx, currency, parse } of PRICE_PATTERNS) {
    if (currency !== expectedCurrency) continue;
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const value = parse(raw);
      if (!Number.isFinite(value)) continue;
      if (value < plausibleRange[0] || value > plausibleRange[1]) continue;
      if (looksLikeNonPrice(content, m.index, m[0])) continue;
      const key = `${currency}:${value}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value, currency, text: m[0], position: m.index });
    }
  }
  return out;
}

function findProductUrls(content: string, supplierSite: string): string[] {
  const siteNoWww = supplierSite.replace(/^www\./, '').toLowerCase();
  const escSite = siteNoWww.replace(/\./g, '\\.');
  const urlRx = new RegExp(`https?:\\/\\/(?:[a-z0-9-]+\\.)*${escSite}\\/[^\\s)"'<>\\]]+`, 'gi');
  const all = content.match(urlRx) ?? [];
  const out: string[] = [];
  for (const raw of all) {
    const clean = raw.replace(/[).,;:!?\]]+$/, '');
    if (/\/(search|busca|s\?|find|q=|wholesale|category|categoria)/i.test(clean)) continue;
    if (PRODUCT_URL_PATTERNS.some((p) => p.test(clean))) out.push(clean);
  }
  return Array.from(new Set(out));
}

function cleanLine(raw: string): string {
  return raw
    .replace(/^[#*\-\s|>]+/, '')
    .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .trim();
}

function isUsableNameLine(cleaned: string): boolean {
  if (cleaned.length < 6 || cleaned.length > 240) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (/^(ver|comprar|adicionar|mais|detalhes?|produto|imagem|frete|envio)\b/i.test(cleaned)) return false;
  // Linha que é só preço/parcela não é nome
  if (/^(R\$|US\$|USD|EUR|€|¥|CNY)\s*[\d.,]+/i.test(cleaned)) return false;
  return true;
}

/**
 * Procura o nome do produto NA PROXIMIDADE do preço (janela 600 chars antes).
 * Volta de baixo pra cima e pega a primeira linha utilizável que contenha
 * tokens da query. Linhas só com link markdown / só com preço são puladas.
 */
function findProductNameNear(content: string, position: number, query: string): string | null {
  const qNorm = matchingService.cacheKey(query);
  const qTokens = qNorm.split(' ').filter((t) => t.length >= 2);
  if (qTokens.length === 0) return null;

  const start = Math.max(0, position - 600);
  const slice = content.slice(start, position);
  const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const cleaned = cleanLine(lines[i] ?? '');
    if (!isUsableNameLine(cleaned)) continue;
    const lineNorm = matchingService.cacheKey(cleaned);
    const matched = qTokens.filter((t) => lineNorm.includes(t)).length;
    if (matched >= Math.ceil(qTokens.length / 2)) {
      return cleaned.slice(0, 200);
    }
  }
  return null;
}

/**
 * Detecta frete a partir de trecho próximo ao preço.
 * Retorna { freight, freightNote } onde freightNote === 'frete grátis confirmado' | 'frete encontrado' | null.
 */
export function detectShipping(snippet: string, currency: string): { freight: number; freightNote: string | null } {
  if (!snippet) return { freight: 0, freightNote: null };
  const lower = snippet.toLowerCase();
  // Frete grátis em PT/EN/ES/ZH
  if (/(frete\s+gr[áa]tis|free\s+shipping|envio\s+gr[áa]tis|env[ií]o\s+gratis|包邮)/i.test(lower)) {
    return { freight: 0, freightNote: 'frete grátis confirmado' };
  }
  // Frete pago — tenta capturar valor próximo
  const sym = currency === 'BRL' ? 'R\\$'
            : currency === 'USD' ? '(?:US\\$|USD|\\$)'
            : currency === 'EUR' ? '(?:€|EUR)'
            : currency === 'CNY' ? '(?:¥|CNY)'
            : 'R\\$';
  const rx = new RegExp(`(?:frete|shipping|env[ií]o)[^\\d]{0,30}${sym}\\s*([\\d.,]+)`, 'i');
  const m = snippet.match(rx);
  if (m && m[1]) {
    const v = currency === 'BRL' || currency === 'EUR' ? parseBR(m[1]) : parseUS(m[1]);
    if (Number.isFinite(v) && v > 0 && v < 5000) {
      return { freight: v, freightNote: 'frete encontrado' };
    }
  }
  return { freight: 0, freightNote: null };
}

interface Candidate {
  name: string;
  price: number;
  currency: string;
  url: string;
  evidenceText: string;
  freight: number;
  freightNote: string | null;
  matchScore: number;
  source: 'json-ld' | 'next-data' | 'markdown';
  distance: number;
}

/**
 * Tenta extrair Products de blocos JSON-LD schema.org.
 */
function extractFromJsonLd(
  content: string,
  supplier: Supplier,
  query: string,
  expectedCurrency: string,
): Candidate[] {
  const rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const range = priceRange(expectedCurrency);
  const out: Candidate[] = [];
  let m: RegExpExecArray | null;

  while ((m = rx.exec(content)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const flatten = (node: unknown): unknown[] => {
      if (Array.isArray(node)) return node.flatMap(flatten);
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        const acc: unknown[] = [obj];
        if (obj['@graph']) acc.push(...flatten(obj['@graph']));
        return acc;
      }
      return [];
    };
    const nodes = flatten(parsed);

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const o = node as Record<string, unknown>;
      const t = o['@type'];
      const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'));
      if (!isProduct) continue;

      const name = typeof o['name'] === 'string' ? (o['name'] as string).trim() : '';
      if (!name || name.length < 3) continue;

      const offers = o['offers'];
      const offerList: unknown[] = Array.isArray(offers) ? offers : offers ? [offers] : [];

      for (const off of offerList) {
        if (!off || typeof off !== 'object') continue;
        const ofObj = off as Record<string, unknown>;
        const priceRaw = ofObj['price'] ?? ofObj['lowPrice'];
        const curRaw = String(ofObj['priceCurrency'] ?? expectedCurrency).toUpperCase();
        if (curRaw !== expectedCurrency) continue;
        const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw ?? '').replace(/,/g, '.'));
        if (!Number.isFinite(price) || price < range[0] || price > range[1]) continue;

        const url = String(o['url'] ?? ofObj['url'] ?? '').trim();
        const match = matchingService.score(query, name);
        if (match.isLikelyAccessory) continue;

        const evidenceText = `${name} — ${curRaw} ${price}`.slice(0, 400);
        out.push({
          name: name.slice(0, 200),
          price,
          currency: curRaw,
          url,
          evidenceText,
          freight: 0,
          freightNote: null,
          matchScore: match.score,
          source: 'json-ld',
          distance: 0,
        });
      }
    }
  }
  return out;
}

/**
 * Tenta extrair Products de __NEXT_DATA__ (Next.js apps frequentemente embedam o estado completo).
 * Navega recursivamente procurando objetos com (name|title) + price + url.
 */
function extractFromNextData(
  content: string,
  supplier: Supplier,
  query: string,
  expectedCurrency: string,
): Candidate[] {
  const m = content.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m || !m[1]) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(m[1]); } catch { return []; }

  const range = priceRange(expectedCurrency);
  const out: Candidate[] = [];
  const siteNoWww = supplier.site.replace(/^www\./, '').toLowerCase();

  function visit(node: unknown, depth: number): void {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) { for (const x of node) visit(x, depth + 1); return; }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;

    const nameLike = (o['name'] ?? o['title'] ?? o['productName'] ?? o['displayName']) as unknown;
    const priceLike = (o['price'] ?? o['salePrice'] ?? o['currentPrice']) as unknown;
    const urlLike = (o['url'] ?? o['href'] ?? o['link']) as unknown;

    if (typeof nameLike === 'string' && (typeof priceLike === 'number' || typeof priceLike === 'string')) {
      const name = nameLike.trim();
      const price = typeof priceLike === 'number' ? priceLike : parseFloat(String(priceLike).replace(/[^\d.,]/g, '').replace(',', '.'));
      if (name.length >= 4 && Number.isFinite(price) && price >= range[0] && price <= range[1]) {
        const match = matchingService.score(query, name);
        if (match.score >= 30 && !match.isLikelyAccessory) {
          let url = '';
          if (typeof urlLike === 'string' && urlLike.length > 0) {
            url = urlLike.startsWith('http') ? urlLike
                : urlLike.startsWith('/') ? `https://${siteNoWww}${urlLike}`
                : urlLike;
          }
          out.push({
            name: name.slice(0, 200),
            price,
            currency: expectedCurrency,
            url,
            evidenceText: `${name} — ${expectedCurrency} ${price}`.slice(0, 400),
            freight: 0,
            freightNote: null,
            matchScore: match.score,
            source: 'next-data',
            distance: 0,
          });
        }
      }
    }

    for (const v of Object.values(o)) visit(v, depth + 1);
  }
  visit(parsed, 0);
  return out;
}

/**
 * Markdown/HTML/texto livre — usa regex de preço + URL próxima + nome próximo.
 */
function extractFromMarkdown(
  content: string,
  supplier: Supplier,
  query: string,
  expectedCurrency: string,
): Candidate[] {
  const range = priceRange(expectedCurrency);
  const prices = findPrices(content, range, expectedCurrency);
  if (prices.length === 0) return [];

  const productUrls = findProductUrls(content, supplier.site);
  const out: Candidate[] = [];

  for (const p of prices) {
    const name = findProductNameNear(content, p.position, query);
    if (!name) continue;

    let bestUrl = '';
    let bestDist = Infinity;
    for (const u of productUrls) {
      const idx = content.indexOf(u);
      if (idx < 0) continue;
      const d = Math.abs(idx - p.position);
      if (d < bestDist) { bestDist = d; bestUrl = u; }
    }

    const matchResult = matchingService.score(query, name);
    if (matchResult.score < 30) continue;
    if (matchResult.isLikelyAccessory) continue;

    const evStart = Math.max(0, p.position - 100);
    const evEnd = Math.min(content.length, p.position + 100);
    const evidenceText = content.slice(evStart, evEnd).replace(/\s+/g, ' ').trim();
    const shipping = detectShipping(content.slice(Math.max(0, p.position - 200), Math.min(content.length, p.position + 200)), expectedCurrency);

    out.push({
      name,
      price: p.value,
      currency: p.currency,
      url: bestUrl,
      evidenceText,
      freight: shipping.freight,
      freightNote: shipping.freightNote,
      matchScore: matchResult.score,
      source: 'markdown',
      distance: bestDist === Infinity ? 9999 : bestDist,
    });
  }
  return out;
}

/**
 * Função principal — combina estratégias e devolve o melhor candidato.
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
      errorMessage: 'Página não retornou conteúdo suficiente',
      sourceUrl,
      sourceName: 'direct-extractor',
    };
  }

  const expectedCurrency = (supplier.currency || 'BRL').toUpperCase();

  const candidates: Candidate[] = [
    ...extractFromJsonLd(content, supplier, query, expectedCurrency),
    ...extractFromNextData(content, supplier, query, expectedCurrency),
    ...extractFromMarkdown(content, supplier, query, expectedCurrency),
  ];

  if (candidates.length === 0) {
    return {
      found: false,
      errorMessage: 'Preço não encontrado com segurança',
      sourceUrl,
      sourceName: 'direct-extractor',
    };
  }

  // Ranking: maior matchScore → menor preço → fonte estruturada (json-ld/next-data) → menor distância
  const sourceWeight: Record<Candidate['source'], number> = { 'json-ld': 0, 'next-data': 1, markdown: 2 };
  candidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (sourceWeight[a.source] !== sourceWeight[b.source]) return sourceWeight[a.source] - sourceWeight[b.source];
    if (a.price !== b.price) return a.price - b.price;
    return a.distance - b.distance;
  });
  const best = candidates[0];
  if (!best) {
    return {
      found: false,
      errorMessage: 'Preço não encontrado com segurança',
      sourceUrl,
      sourceName: 'direct-extractor',
    };
  }

  // Confiança: estrutura confiável (JSON-LD/__NEXT_DATA__) ganha bônus
  let confidence = 20;
  const hasDirectUrl = best.url && PRODUCT_URL_PATTERNS.some((p) => p.test(best.url));
  if (hasDirectUrl) confidence += 40;
  if (best.source === 'json-ld') confidence += 30;
  else if (best.source === 'next-data') confidence += 20;
  if (best.matchScore >= 75) confidence += 30;
  else if (best.matchScore >= 50) confidence += 15;
  else confidence += 5;

  // Frete: emite warning informativo (grátis confirmado / não encontrado)
  let shippingWarn: string | null = null;
  if (best.freightNote === 'frete grátis confirmado') {
    shippingWarn = 'Frete grátis confirmado';
  } else if (!best.freightNote) {
    shippingWarn = 'Frete não encontrado; total pode mudar no checkout';
    confidence = Math.max(20, confidence - 10);
  }

  return {
    found: true,
    productName: best.name,
    price: best.price,
    currency: best.currency,
    link: best.url || undefined,
    freight: best.freight,
    freightNote: best.freightNote ?? undefined,
    evidenceText: best.evidenceText,
    sourceUrl,
    sourceName: `direct-${best.source}`,
    matchScore: best.matchScore,
    confidence: Math.min(100, confidence),
    warning: shippingWarn ?? undefined,
    available: true,
  };
}

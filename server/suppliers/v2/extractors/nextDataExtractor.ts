/**
 * Extractor __NEXT_DATA__ — caminha recursivamente o JSON de hidratação
 * do Next.js procurando campos compatíveis com produto/preço.
 *
 * Função PURA — não toca rede ou DB.
 *
 * Estratégia: faz busca em largura por:
 *  - chaves nome: name | title | productName | product_name
 *  - chaves preço: price | salePrice | currentPrice | priceNumber | finalPrice
 *  - chaves moeda: currency | priceCurrency | currencyCode
 *  - chaves url: url | productUrl | canonicalUrl | permalink | slug
 *  - chaves imagem: image | images | imageUrl | thumbnail
 *
 * Retorna o primeiro nó que tem ao menos nome + preço plausível.
 */
import type { ExtractedProductData } from './types.js';

const NAME_KEYS = new Set(['name', 'title', 'productname', 'product_name']);
const PRICE_KEYS = new Set([
  'price',
  'saleprice',
  'currentprice',
  'pricenumber',
  'finalprice',
]);
const CURRENCY_KEYS = new Set(['currency', 'pricecurrency', 'currencycode']);
const URL_KEYS = new Set(['url', 'producturl', 'canonicalurl', 'permalink']);
const IMAGE_KEYS = new Set(['image', 'imageurl', 'thumbnail']);

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
    if (!cleaned) return undefined;
    if (/,\d{1,2}$/.test(cleaned)) {
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(normalized);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

interface NextDataCandidate {
  productName?: string;
  price?: number;
  currency?: string;
  productUrl?: string;
  image?: string;
}

function inspectNode(node: Record<string, unknown>): NextDataCandidate | null {
  const cand: NextDataCandidate = {};
  for (const [rawKey, value] of Object.entries(node)) {
    const key = rawKey.toLowerCase();
    if (!cand.productName && NAME_KEYS.has(key)) {
      const s = asString(value);
      if (s && s.length >= 3 && s.length < 300) cand.productName = s;
    } else if (!cand.price && PRICE_KEYS.has(key)) {
      const n = asNumber(value);
      if (n) cand.price = n;
    } else if (!cand.currency && CURRENCY_KEYS.has(key)) {
      const s = asString(value);
      if (s && s.length <= 5) cand.currency = s.toUpperCase();
    } else if (!cand.productUrl && URL_KEYS.has(key)) {
      const s = asString(value);
      if (s && /^https?:\/\//i.test(s)) cand.productUrl = s;
    } else if (!cand.image && IMAGE_KEYS.has(key)) {
      const s = asString(value);
      if (s) cand.image = s;
      else if (Array.isArray(value) && typeof value[0] === 'string') {
        cand.image = value[0];
      }
    }
  }
  // Considera só nós que têm nome E preço — evita pegar nós soltos de outras
  // entidades (categoria, banner, etc).
  if (cand.productName && cand.price) return cand;
  return null;
}

function walkForProduct(root: unknown): NextDataCandidate | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const node = queue.shift();
    visited++;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const child of node) queue.push(child);
      continue;
    }
    const obj = node as Record<string, unknown>;
    const cand = inspectNode(obj);
    if (cand) return cand;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return null;
}

export function extractFromNextData(
  html: string,
  productUrl: string,
): ExtractedProductData | null {
  const m = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  const raw = (m[1] ?? '').trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const cand = walkForProduct(parsed);
  if (!cand) return null;

  if (!cand.productName || !cand.price || cand.price <= 0) return null;

  const evidenceText =
    `__NEXT_DATA__ · name="${cand.productName}" · price=${cand.price} ${cand.currency ?? ''}`.trim();
  return {
    strategy: 'next_data',
    productName: cand.productName,
    price: cand.price,
    currency: cand.currency,
    productUrl: cand.productUrl ?? productUrl,
    image: cand.image,
    evidenceText,
    confidence: 70,
  };
}

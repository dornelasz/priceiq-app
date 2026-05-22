/**
 * Extractor de scripts JSON genéricos (`<script type="application/json">`)
 * que NÃO sejam `__NEXT_DATA__` (esse é tratado por nextDataExtractor).
 *
 * Conservador: só aceita quando o JSON tem CLARAMENTE sinais de produto
 * com preço — para evitar falso positivo de dados não-produto (banners,
 * tracking, config de UI, etc).
 *
 * Função PURA — não toca rede ou DB.
 */
import type { ExtractedProductData } from './types.js';
import { extractFromNextData } from './nextDataExtractor.js';

const NAME_KEYS = new Set(['name', 'title', 'productname', 'product_name']);
const PRICE_KEYS = new Set([
  'price',
  'saleprice',
  'currentprice',
  'finalprice',
]);
const CURRENCY_KEYS = new Set(['currency', 'pricecurrency', 'currencycode']);

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
    if (!cleaned) return undefined;
    if (/,\d{1,2}$/.test(cleaned)) {
      const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
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

interface ProductCandidate {
  productName: string;
  price: number;
  currency?: string;
}

function inspectNode(node: Record<string, unknown>): ProductCandidate | null {
  let name: string | undefined;
  let price: number | undefined;
  let currency: string | undefined;
  for (const [rawKey, value] of Object.entries(node)) {
    const key = rawKey.toLowerCase();
    if (!name && NAME_KEYS.has(key)) {
      const s = asString(value);
      if (s && s.length >= 3 && s.length < 300) name = s;
    } else if (!price && PRICE_KEYS.has(key)) {
      const n = asNumber(value);
      if (n) price = n;
    } else if (!currency && CURRENCY_KEYS.has(key)) {
      const s = asString(value);
      if (s && s.length <= 5) currency = s.toUpperCase();
    }
  }
  if (name && price) return { productName: name, price, currency };
  return null;
}

function walk(root: unknown): ProductCandidate | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < 3_000) {
    const node = queue.shift();
    visited++;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const child of node) queue.push(child);
      continue;
    }
    const obj = node as Record<string, unknown>;
    const c = inspectNode(obj);
    if (c) return c;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return null;
}

export function extractFromScriptJson(
  html: string,
  productUrl: string,
): ExtractedProductData | null {
  // Pega scripts JSON genéricos — exclui __NEXT_DATA__ (tratado em outro extractor).
  const blocks = [
    ...html.matchAll(
      /<script([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi,
    ),
  ];

  for (const m of blocks) {
    const attrs = m[1] ?? '';
    if (/id=["']__NEXT_DATA__["']/i.test(attrs)) continue; // delega para o nextDataExtractor

    // Conservador: precisa ter sinal forte de produto ("price" + "name"/"product")
    const raw = (m[2] ?? '').trim();
    if (!raw) continue;
    if (!/"(?:price|salePrice|finalPrice|currentPrice)"\s*:/i.test(raw)) continue;
    if (!/"(?:name|title|product)/i.test(raw)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const cand = walk(parsed);
    if (!cand) continue;

    return {
      strategy: 'script_json',
      productName: cand.productName,
      price: cand.price,
      currency: cand.currency,
      productUrl,
      evidenceText: `script JSON · name="${cand.productName}" · price=${cand.price} ${cand.currency ?? ''}`.trim(),
      confidence: 55,
    };
  }

  // Defensivo: se chamado isoladamente e há __NEXT_DATA__, delega.
  return extractFromNextData(html, productUrl);
}

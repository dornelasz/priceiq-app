/**
 * Extractor de meta tags — usa OpenGraph e `product:price:amount` quando
 * o site fornece os metadados padronizados.
 *
 * Função PURA — não toca rede ou DB.
 */
import type { ExtractedProductData } from './types.js';

function metaContent(html: string, property: string): string | undefined {
  // Aceita property=... e name=... (alguns sites usam name="og:foo")
  const rxes = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
      'i',
    ),
  ];
  for (const rx of rxes) {
    const m = html.match(rx);
    if (m && m[1]) return m[1];
  }
  return undefined;
}

function parsePrice(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!cleaned) return undefined;
  if (/,\d{1,2}$/.test(cleaned)) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function extractFromMetaTags(
  html: string,
  productUrl: string,
): ExtractedProductData | null {
  const title =
    metaContent(html, 'og:title') ??
    metaContent(html, 'twitter:title') ??
    metaContent(html, 'title');
  const priceStr =
    metaContent(html, 'product:price:amount') ??
    metaContent(html, 'og:price:amount') ??
    metaContent(html, 'price');
  const currency =
    metaContent(html, 'product:price:currency') ??
    metaContent(html, 'og:price:currency');
  const image =
    metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  const url = metaContent(html, 'og:url') ?? productUrl;

  if (!priceStr && !title) return null;

  const price = parsePrice(priceStr);
  const hasPriceAndName =
    typeof price === 'number' && price > 0 && !!title && title.trim() !== '';

  if (!hasPriceAndName) {
    return {
      strategy: 'meta_tags',
      productName: title?.trim(),
      price: typeof price === 'number' ? price : undefined,
      currency: currency?.toUpperCase(),
      productUrl: url,
      image,
      evidenceText: title
        ? `og:title="${title.trim()}" · sem preço explícito em meta`
        : undefined,
      confidence: title ? 25 : 0,
    };
  }

  const evidenceText =
    `meta product:price=${price} ${currency ?? ''} · og:title="${title.trim()}"`.trim();
  return {
    strategy: 'meta_tags',
    productName: title.trim(),
    price,
    currency: currency?.toUpperCase(),
    productUrl: url,
    image,
    evidenceText,
    confidence: 75,
  };
}

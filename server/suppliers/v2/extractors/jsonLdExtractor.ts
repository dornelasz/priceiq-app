/**
 * Extractor JSON-LD — fonte estruturada mais confiável.
 *
 * Procura todos os blocos `<script type="application/ld+json">` no HTML e
 * tenta achar `@type: Product` com `offers.price` etc. Aceita Product
 * isolado, dentro de `@graph`, ou array de produtos.
 *
 * Função PURA — não toca rede ou DB.
 */
import type { ExtractedProductData } from './types.js';

interface OfferLike {
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  url?: string;
}

interface ProductLike {
  '@type'?: string | string[];
  name?: string;
  url?: string;
  image?: string | string[] | { url?: string };
  offers?: OfferLike | OfferLike[];
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // Aceita "1234.56" ou "1.234,56" ou "1234,56"
    const cleaned = v.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
    if (!cleaned) return undefined;
    // Se tem vírgula como decimal (estilo BR) e ponto como milhar
    if (/,\d{1,2}$/.test(cleaned)) {
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(normalized);
      return Number.isFinite(n) ? n : undefined;
    }
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function typeIs(node: ProductLike, type: string): boolean {
  const t = node['@type'];
  if (!t) return false;
  if (typeof t === 'string') return t.toLowerCase() === type.toLowerCase();
  return Array.isArray(t) && t.some((x) => x.toLowerCase() === type.toLowerCase());
}

function pickFirstOffer(offers: OfferLike | OfferLike[] | undefined): OfferLike | undefined {
  if (!offers) return undefined;
  if (Array.isArray(offers)) return offers[0];
  return offers;
}

function pickImage(image: ProductLike['image']): string | undefined {
  if (!image) return undefined;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return typeof image[0] === 'string' ? image[0] : undefined;
  if (typeof image === 'object' && image && typeof image.url === 'string') return image.url;
  return undefined;
}

function findProductInNode(node: unknown): ProductLike | null {
  if (!node || typeof node !== 'object') return null;
  // Direct Product
  if (typeIs(node as ProductLike, 'Product')) return node as ProductLike;
  // @graph
  const graph = (node as { '@graph'?: unknown[] })['@graph'];
  if (Array.isArray(graph)) {
    for (const child of graph) {
      const found = findProductInNode(child);
      if (found) return found;
    }
  }
  return null;
}

export function extractFromJsonLd(
  html: string,
  productUrl: string,
): ExtractedProductData | null {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  if (blocks.length === 0) return null;

  for (const block of blocks) {
    const raw = (block[1] ?? '').trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const product = findProductInNode(node);
      if (!product) continue;

      const offer = pickFirstOffer(product.offers);
      const price = offer ? toNumber(offer.price) : undefined;
      const currency = offer?.priceCurrency
        ? String(offer.priceCurrency).toUpperCase()
        : undefined;
      const name =
        typeof product.name === 'string' ? product.name.trim() : undefined;
      const url =
        typeof product.url === 'string' && product.url.trim() !== ''
          ? product.url
          : productUrl;
      const image = pickImage(product.image);
      const available = offer?.availability
        ? /InStock/i.test(offer.availability)
        : undefined;

      const hasPriceAndName =
        typeof price === 'number' && price > 0 && !!name;
      if (!hasPriceAndName) {
        // Produto sem preço/nome no JSON-LD — não bloqueia outros extractors.
        return {
          strategy: 'json_ld',
          productName: name,
          price: typeof price === 'number' ? price : undefined,
          currency,
          productUrl: url,
          available,
          image,
          evidenceText: name
            ? `JSON-LD Product encontrado: "${name}" (sem preço)`
            : undefined,
          confidence: name ? 30 : 0,
        };
      }

      const evidenceText =
        `JSON-LD Product "${name}" · price=${price} ${currency ?? ''}`.trim();
      return {
        strategy: 'json_ld',
        productName: name,
        price,
        currency,
        productUrl: url,
        available,
        image,
        evidenceText,
        confidence: 90,
      };
    }
  }
  return null;
}

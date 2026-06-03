/**
 * Detecta candidatos a página de produto em uma SERP e classifica se uma
 * página específica é página de produto.
 *
 * Funções PURAS — sem rede. Recebem HTML e retornam classificação.
 */

export interface ProductCandidate {
  url: string;
  text?: string;
  confidence: number;
  reason: string;
}

export interface ProductCandidatesInput {
  searchPageHtml: string;
  searchPageUrl: string;
  baseUrl: string;
}

export interface ProductCandidatesResult {
  candidates: ProductCandidate[];
}

const POSITIVE_URL_PATTERNS: Array<{
  rx: RegExp;
  score: number;
  reason: string;
}> = [
  { rx: /\/dp\/[A-Z0-9]+/i, score: 80, reason: 'amazon-dp' },
  { rx: /MLB-?\d{6,}/i, score: 80, reason: 'mercadolivre-id' },
  { rx: /MLU-?\d{6,}/i, score: 80, reason: 'mercadolivre-uy-id' },
  { rx: /\/i\.\d+\.\d+/i, score: 70, reason: 'shopee-id' },
  { rx: /\/products?\//i, score: 65, reason: 'products-path' },
  { rx: /\/produtos?\//i, score: 65, reason: 'produtos-path' },
  { rx: /\/p\/[a-z0-9][^/]*\/?$/i, score: 55, reason: 'short-p-path' },
  { rx: /\/item\/[a-z0-9]/i, score: 55, reason: 'item-path' },
  { rx: /\/sku\//i, score: 55, reason: 'sku-path' },
];

const NEGATIVE_URL_PATTERNS: RegExp[] = [
  /\/cart(\/|$)/i,
  /\/carrinho(\/|$)/i,
  /\/checkout(\/|$)/i,
  /\/finalizar/i,
  /\/login/i,
  /\/account/i,
  /\/conta\//i,
  /\/category\//i,
  /\/categoria\//i,
  /\/categories\//i,
  /\/collections?\//i,
  /\/help/i,
  /\/about/i,
  /\/sobre/i,
  /\/contact/i,
  /\/contato/i,
  /\/privacy/i,
  /\/termos/i,
  /\/wishlist/i,
  /\/favoritos/i,
  /\/blog\//i,
  /\/page\//i,
  /\.(?:png|jpe?g|gif|webp|svg|css|js)(?:\?|$)/i,
];

export function detectProductCandidates(
  input: ProductCandidatesInput,
): ProductCandidatesResult {
  const map = new Map<string, ProductCandidate>();
  const linkRx = /<a\b[^>]*href=["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRx.exec(input.searchPageHtml)) !== null) {
    const rawHref = m[1];
    const inner = m[2] ?? '';
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) {
      continue;
    }

    let absUrl: string;
    try {
      absUrl = new URL(rawHref, input.searchPageUrl).toString();
    } catch {
      continue;
    }

    if (NEGATIVE_URL_PATTERNS.some((p) => p.test(absUrl))) continue;

    for (const pattern of POSITIVE_URL_PATTERNS) {
      if (pattern.rx.test(absUrl)) {
        const existing = map.get(absUrl);
        if (!existing || existing.confidence < pattern.score) {
          map.set(absUrl, {
            url: absUrl,
            text: text || undefined,
            confidence: pattern.score,
            reason: pattern.reason,
          });
        }
        break;
      }
    }
  }

  return {
    candidates: Array.from(map.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5),
  };
}

// ─── Classificação de página única como produto ────────────────────────

export interface ProductPageInput {
  html: string;
  url: string;
}

export interface ProductPageResult {
  isProductPage: boolean;
  confidence: number;
  reasons: string[];
}

const PRODUCT_PAGE_MIN_CONFIDENCE = 40;

export function isLikelyProductPage(
  input: ProductPageInput,
): ProductPageResult {
  const html = input.html ?? '';
  const reasons: string[] = [];
  let confidence = 0;

  // JSON-LD Product
  const jsonLdMatches = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (jsonLdMatches) {
    for (const block of jsonLdMatches) {
      if (/"@type"\s*:\s*"Product"/i.test(block)) {
        reasons.push('json_ld_product');
        confidence += 55;
        break;
      }
    }
  }

  // schema.org/Product microdata
  if (/itemtype=["'][^"']*schema\.org\/Product/i.test(html)) {
    reasons.push('schema_org_product');
    confidence += 30;
  }

  // og:type=product
  if (
    /<meta[^>]+property=["']og:type["'][^>]+content=["'](?:product|product\.item)["']/i.test(html) ||
    /<meta[^>]+content=["'](?:product|product\.item)["'][^>]+property=["']og:type["']/i.test(html)
  ) {
    reasons.push('og_type_product');
    confidence += 25;
  }

  // product:price:amount / og:price:amount
  if (
    /<meta[^>]+property=["'](?:product:price:amount|og:price:amount)["']/i.test(html)
  ) {
    reasons.push('meta_product_price');
    confidence += 30;
  }

  // Call to action de compra
  if (
    /(adicionar ao carrinho|add to cart|comprar agora|buy now|add to basket|adicionar à sacola)/i.test(html)
  ) {
    reasons.push('cta_buy');
    confidence += 15;
  }

  // Preço textual visível
  if (/R\$\s*\d|US\$\s*\d|\$\s*\d|€\s*\d/i.test(html)) {
    reasons.push('price_text');
    confidence += 10;
  }

  // URL com padrão de produto
  if (/\/products?\/|\/produtos?\/|\/p\/|\/dp\/|-MLB-/i.test(input.url)) {
    reasons.push('url_product_pattern');
    confidence += 15;
  }

  confidence = Math.min(95, confidence);
  return {
    isProductPage: confidence >= PRODUCT_PAGE_MIN_CONFIDENCE,
    confidence,
    reasons,
  };
}

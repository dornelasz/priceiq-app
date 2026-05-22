/**
 * Detecta a estratégia de extração mais provável para a página de produto.
 *
 * Ordem de preferência (mais confiável → menos):
 *   json_ld → schema_org → meta_tags → next_data → script_json → dom →
 *   visual_heuristic.
 *
 * Função PURA — não executa a extração real, apenas indica qual receita
 * deve ser usada (e com qual nível de confiança).
 */
import type { ExtractionStrategy } from '../types.js';

export interface ExtractorDetectorInput {
  productPageHtml: string;
  productPageUrl: string;
}

export interface ExtractorDetectorResult {
  extractionStrategy: ExtractionStrategy | null;
  confidence: number;
  signals: string[];
  jsonLdEnabled: boolean;
  jsonPaths?: Record<string, unknown> | null;
  requiresJs?: boolean;
  requiresBrowser?: boolean;
}

export function detectExtractionStrategy(
  input: ExtractorDetectorInput,
): ExtractorDetectorResult {
  const html = input.productPageHtml ?? '';
  const signals: string[] = [];

  // ─── 1. JSON-LD Product+Offer ────────────────────────────────────────
  const jsonLdBlocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1] ?? '');

  let jsonLdHasProduct = false;
  let jsonLdHasOffer = false;
  let jsonLdHasPrice = false;
  for (const block of jsonLdBlocks) {
    if (/"@type"\s*:\s*"Product"/i.test(block)) jsonLdHasProduct = true;
    if (/"@type"\s*:\s*"Offer"/i.test(block) || /"offers"\s*:/i.test(block)) {
      jsonLdHasOffer = true;
    }
    if (/"price"\s*:/i.test(block)) jsonLdHasPrice = true;
  }

  if (jsonLdHasProduct && jsonLdHasOffer && jsonLdHasPrice) {
    signals.push('json_ld_product+offer+price');
    return {
      extractionStrategy: 'json_ld',
      confidence: 90,
      signals,
      jsonLdEnabled: true,
      jsonPaths: null,
      requiresJs: false,
      requiresBrowser: false,
    };
  }
  if (jsonLdHasProduct && jsonLdHasPrice) {
    signals.push('json_ld_product+price');
  }

  // ─── 2. schema.org microdata ─────────────────────────────────────────
  const hasSchemaProduct = /itemtype=["'][^"']*schema\.org\/Product/i.test(html);
  const hasSchemaPrice = /itemprop=["']price["']/i.test(html);
  if (hasSchemaProduct && hasSchemaPrice) {
    signals.push('schema_org_product+price');
    return {
      extractionStrategy: 'schema_org',
      confidence: 80,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }
  if (hasSchemaProduct) signals.push('schema_org_product');

  // ─── 3. Meta tags ────────────────────────────────────────────────────
  const hasMetaPrice =
    /<meta[^>]+property=["'](?:product:price:amount|og:price:amount)["']/i.test(html) ||
    /<meta[^>]+name=["']price["']/i.test(html);
  const hasOgProduct =
    /<meta[^>]+property=["']og:type["'][^>]+content=["'](?:product|product\.item)["']/i.test(html);
  if (hasMetaPrice && hasOgProduct) {
    signals.push('og_product+price');
    return {
      extractionStrategy: 'meta_tags',
      confidence: 75,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }
  if (hasMetaPrice) {
    signals.push('meta_price');
    return {
      extractionStrategy: 'meta_tags',
      confidence: 65,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }

  // ─── 4. __NEXT_DATA__ ────────────────────────────────────────────────
  if (/<script[^>]+id=["']__NEXT_DATA__["']/i.test(html)) {
    signals.push('next_data');
    return {
      extractionStrategy: 'next_data',
      confidence: 70,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }

  // ─── 5. Script JSON inline ───────────────────────────────────────────
  if (
    /<script[^>]+type=["']application\/json["'][^>]*>[\s\S]*?\{[\s\S]*?"price"\s*:/i.test(html)
  ) {
    signals.push('script_json_price');
    return {
      extractionStrategy: 'script_json',
      confidence: 55,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }

  // ─── 6. DOM com preço textual ────────────────────────────────────────
  const hasTextPrice = /R\$\s*\d|US\$\s*\d|\$\s*\d|€\s*\d/i.test(html);
  if (hasTextPrice) {
    signals.push('text_price');
    return {
      extractionStrategy: 'dom',
      confidence: 45,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }

  // ─── 7. Visual heuristic — sinal residual de produto sem preço ──────
  if (jsonLdHasProduct || hasSchemaProduct || hasOgProduct) {
    signals.push('product_signal_without_price');
    return {
      extractionStrategy: 'visual_heuristic',
      confidence: 25,
      signals,
      jsonLdEnabled: jsonLdHasProduct,
      requiresJs: false,
      requiresBrowser: false,
    };
  }

  // ─── 8. Nada ─────────────────────────────────────────────────────────
  return {
    extractionStrategy: null,
    confidence: 0,
    signals,
    jsonLdEnabled: false,
    requiresJs: false,
    requiresBrowser: false,
  };
}

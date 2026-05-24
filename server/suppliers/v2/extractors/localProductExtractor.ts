/**
 * localProductExtractor — orquestrador local único de extração de produto.
 *
 * Recebe conteúdo JÁ COLETADO (html e/ou markdown) + url + supplier + query e
 * devolve um UniversalSearchResult compatível com o V2. NÃO faz fetch, NÃO usa
 * IA, NÃO usa serviço externo. É o cérebro local fortalecido da Etapa 4.
 *
 * Ordem de extração (mais confiável → menos):
 *   1. JSON-LD Product/Offer
 *   2. Meta tags og/product
 *   3. __NEXT_DATA__
 *   4. scripts JSON genéricos
 *   5. DOM/html (preço principal via ranker de candidatos)
 *   6. markdown/texto limpo
 *
 * Regras (mantém Etapas anteriores):
 *   - Sem produto+preço+evidência → falha controlada (não inventa).
 *   - Frete desconhecido → not_available (NUNCA 0). Etapa 3 decide partial.
 *   - Link de busca/categoria/home/carrinho/login/checkout NUNCA vira produto.
 *   - Produto diferente da query → product_mismatch.
 *
 * Função PURA.
 */
import type {
  ExtractionStrategy,
  UniversalSearchResult,
} from '../types.js';
import type { Supplier } from '../../../services/supplierService.js';
import type { ExtractedProductData } from './types.js';
import { extractFromJsonLd } from './jsonLdExtractor.js';
import { extractFromMetaTags } from './metaTagExtractor.js';
import { extractFromNextData } from './nextDataExtractor.js';
import { extractFromScriptJson } from './scriptJsonExtractor.js';
import { extractFromDom } from './domExtractor.js';
import { extractFromMarkdown } from './markdownExtractor.js';
import { extractFreight } from './freightExtractor.js';
import { detectAvailability } from './availability.js';
import { classifyUrl } from './linkClassifier.js';
import type { SupportedCurrency } from './moneyParser.js';
import { matchProduct } from '../matching/productMatcher.js';
import {
  buildStatusResult,
  buildValidatedResult,
  buildMismatchResult,
} from '../recipeRunner/resultBuilder.js';

const HTML_EXTRACTORS: Array<{
  strategy: ExtractionStrategy;
  extract: (html: string, url: string) => ExtractedProductData | null;
}> = [
  { strategy: 'json_ld', extract: extractFromJsonLd },
  { strategy: 'meta_tags', extract: extractFromMetaTags },
  { strategy: 'next_data', extract: extractFromNextData },
  { strategy: 'script_json', extract: extractFromScriptJson },
  { strategy: 'dom', extract: extractFromDom },
];

function reorder(
  preferred: ExtractionStrategy | null | undefined,
): typeof HTML_EXTRACTORS {
  if (!preferred) return HTML_EXTRACTORS;
  const idx = HTML_EXTRACTORS.findIndex((e) => e.strategy === preferred);
  if (idx < 0) return HTML_EXTRACTORS;
  const head = HTML_EXTRACTORS[idx]!;
  return [head, ...HTML_EXTRACTORS.filter((_, i) => i !== idx)];
}

function isComplete(d: ExtractedProductData | null): boolean {
  return !!(
    d &&
    d.productName &&
    d.productName.trim() !== '' &&
    typeof d.price === 'number' &&
    d.price > 0 &&
    d.currency &&
    d.currency.trim() !== '' &&
    d.evidenceText
  );
}

function asSupportedCurrency(c: string | undefined): SupportedCurrency {
  const up = (c ?? 'BRL').toUpperCase();
  if (up === 'BRL' || up === 'USD' || up === 'EUR' || up === 'CNY') return up;
  return 'BRL';
}

export interface LocalExtractionInput {
  url: string;
  supplier: Supplier;
  query: string;
  html?: string;
  markdown?: string;
  preferredStrategy?: ExtractionStrategy | null;
  minMatchScore?: number;
}

/**
 * Roda a cascata de extractors e devolve o melhor candidato.
 * Prefere extração COMPLETA (nome+preço+moeda+evidência); na ausência, mantém
 * a parcial de maior confiança (ex: nome sem preço) para diagnóstico.
 */
function extractBest(input: LocalExtractionInput): ExtractedProductData | null {
  const expectedCurrency = asSupportedCurrency(input.supplier.currency);
  let best: ExtractedProductData | null = null;

  if (input.html) {
    for (const ex of reorder(input.preferredStrategy)) {
      const got = ex.extract(input.html, input.url);
      if (!got) continue;
      if (isComplete(got)) return got;
      if (!best || got.confidence > best.confidence) best = got;
    }
  }

  if (input.markdown) {
    const md = extractFromMarkdown({
      markdown: input.markdown,
      productUrl: input.url,
      query: input.query,
      expectedCurrency,
    });
    if (isComplete(md)) return md;
    if (md && (!best || md.confidence > best.confidence)) best = md;
  }

  return best;
}

export function extractLocalProduct(
  input: LocalExtractionInput,
): UniversalSearchResult {
  const minMatchScore = input.minMatchScore ?? 50;

  // ─── 1. Link nunca pode ser busca/categoria/home/carrinho/login/checkout ─
  const cls = classifyUrl(input.url);
  if (cls.type !== 'product' && cls.type !== 'unknown') {
    return buildStatusResult(
      'invalid_link',
      `link classificado como "${cls.type}" — não é página de produto`,
    );
  }

  if (!input.html && !input.markdown) {
    return buildStatusResult('not_found', 'sem conteúdo para extrair');
  }

  // ─── 2. Extração em cascata ──────────────────────────────────────────────
  const extracted = extractBest(input);

  if (!extracted || !extracted.productName || !extracted.evidenceText) {
    return buildStatusResult('not_found', 'produto/evidência não identificados no conteúdo');
  }

  // ─── 3. Preço/moeda obrigatórios ─────────────────────────────────────────
  if (typeof extracted.price !== 'number' || extracted.price <= 0) {
    return buildStatusResult(
      'price_not_found',
      `produto "${extracted.productName}" sem preço confiável`,
    );
  }
  const currency = asSupportedCurrency(extracted.currency);
  if (!extracted.currency || extracted.currency.trim() === '') {
    return buildStatusResult('price_not_found', 'preço sem moeda definida');
  }

  // ─── 4. Link de produto precisa ser confirmado ───────────────────────────
  if (!cls.isProduct) {
    return buildStatusResult(
      'invalid_link',
      `URL "${input.url}" não tem padrão reconhecível de produto`,
    );
  }

  // ─── 5. Matching com a query ─────────────────────────────────────────────
  const match = matchProduct(input.query, extracted.productName);
  if (match.isAccessory || match.score < minMatchScore) {
    return buildMismatchResult({
      productName: extracted.productName,
      productUrl: input.url,
      matchScore: match.score,
      reason: match.isAccessory
        ? 'produto parece acessório e a query não pediu acessório'
        : `match score ${match.score} abaixo do mínimo ${minMatchScore}`,
    });
  }

  // ─── 6. Frete (grátis/pago/desconhecido) com evidência ───────────────────
  const freightSource = input.html ?? input.markdown ?? '';
  const fr = extractFreight(freightSource, currency);
  const freight =
    fr.state === 'free_confirmed'
      ? { state: 'free_confirmed' as const, value: 0, evidence: fr.evidence }
      : fr.state === 'confirmed' && typeof fr.value === 'number'
        ? { state: 'confirmed' as const, value: fr.value, evidence: fr.evidence }
        : { state: 'not_available' as const, value: null, evidence: null };

  // ─── 7. Disponibilidade ──────────────────────────────────────────────────
  const avail = detectAvailability(freightSource);
  const available = extracted.available ?? avail.available;

  // ─── 8. Resultado validado (frete decide partial na Etapa 3) ─────────────
  const freightNote =
    freight.state === 'free_confirmed'
      ? ' · frete grátis confirmado'
      : freight.state === 'confirmed'
        ? ` · frete ${currency} ${freight.value}`
        : ' · frete a confirmar';

  return buildValidatedResult({
    productName: extracted.productName,
    price: extracted.price,
    currency,
    productUrl: input.url,
    evidenceText: `${extracted.evidenceText}${freightNote}`,
    sourceUrl: input.url,
    strategy: extracted.strategy,
    matchScore: match.score,
    confidence: extracted.confidence,
    available: available ?? null,
    image: extracted.image ?? null,
    freight,
  });
}

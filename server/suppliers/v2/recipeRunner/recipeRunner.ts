/**
 * Recipe Runner — executa uma SupplierRecipe certificada e devolve um
 * UniversalSearchResult validado (ou um status controlado de falha).
 *
 * A partir desta versão, suporta conteúdo HTML (fetch direto) e markdown
 * (Jina/Firecrawl). Quando o conteúdo é markdown, usa o markdownExtractor
 * em vez dos extractors de HTML (JSON-LD, meta tags, etc.).
 *
 * Princípios absolutos:
 *  - Frete desconhecido NUNCA vira 0 — fica `not_available`.
 *  - Nada é inventado: sem produto+preço+evidência → falha controlada.
 */
import type {
  ExtractionStrategy,
  SearchResultStatusV2,
  SupplierRecipe,
  UniversalSearchResult,
} from '../types.js';
import type { Supplier } from '../../../services/supplierService.js';
import {
  createDefaultFetcher,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type ContentType,
} from '../fetching/contentFetcher.js';
import {
  EXTRACTORS_IN_ORDER,
  MARKDOWN_EXTRACTOR,
  detectFreeShipping,
  type ExtractedProductData,
  type RegisteredExtractor,
} from '../extractors/index.js';
import { matchProduct } from '../matching/index.js';
import { validateRecipe } from './recipeValidator.js';
import { extractCandidates, type CandidateUrl } from './candidateExtractor.js';
import {
  buildStatusResult,
  buildValidatedResult,
  buildMismatchResult,
} from './resultBuilder.js';

export interface RunSupplierRecipeInput {
  supplier: Supplier;
  recipe: SupplierRecipe;
  query: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  maxCandidates?: number;
  minMatchScore?: number;
}

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_MIN_MATCH_SCORE = 50;

function normalizeBase(site: string): string {
  if (/^https?:\/\//i.test(site)) {
    try {
      const u = new URL(site);
      return `${u.protocol}//${u.host}`;
    } catch {
      return site.replace(/\/+$/, '');
    }
  }
  return `https://${site.replace(/^\/+/, '')}`;
}

function expandTemplate(template: string, query: string): string {
  const enc = encodeURIComponent(query);
  return template
    .replace(/\{query\}/gi, enc)
    .replace(/\{q\}/gi, enc)
    .replace(/\{produto\}/gi, enc);
}

function fetchStatusToResultStatus(
  status: 'ok' | 'blocked' | 'requires_login' | 'not_found' | 'error',
  errorMessage?: string,
): { status: SearchResultStatusV2; message?: string } {
  if (status === 'blocked') {
    return { status: 'blocked', message: errorMessage ?? 'fornecedor bloqueou acesso' };
  }
  if (status === 'requires_login') {
    return {
      status: 'blocked',
      message: errorMessage ?? 'fornecedor exige login para acesso',
    };
  }
  if (status === 'not_found') {
    return { status: 'not_found', message: errorMessage ?? 'página não encontrada' };
  }
  const isTimeout = /timeout|tempo esgotado|abort/i.test(errorMessage ?? '');
  return {
    status: isTimeout ? 'timeout' : 'error',
    message: errorMessage ?? 'falha técnica',
  };
}

function reorderExtractors(
  preferred: ExtractionStrategy | null | undefined,
): RegisteredExtractor[] {
  if (!preferred) return EXTRACTORS_IN_ORDER;
  const idx = EXTRACTORS_IN_ORDER.findIndex((e) => e.strategy === preferred);
  if (idx < 0) return EXTRACTORS_IN_ORDER;
  const head = EXTRACTORS_IN_ORDER[idx];
  if (!head) return EXTRACTORS_IN_ORDER;
  return [head, ...EXTRACTORS_IN_ORDER.filter((_, i) => i !== idx)];
}

function runExtractors(
  content: string,
  candidateUrl: string,
  preferred: ExtractionStrategy | null | undefined,
  contentType: ContentType,
): ExtractedProductData | null {
  if (contentType === 'markdown') {
    return MARKDOWN_EXTRACTOR.extract(content, candidateUrl);
  }

  let bestPartial: ExtractedProductData | null = null;
  for (const ex of reorderExtractors(preferred)) {
    const got = ex.extract(content, candidateUrl);
    if (!got) continue;
    if (
      got.productName &&
      typeof got.price === 'number' &&
      got.price > 0
    ) {
      return got;
    }
    if (!bestPartial || got.confidence > bestPartial.confidence) {
      bestPartial = got;
    }
  }
  return bestPartial;
}

function detectFreeShippingFromContent(
  content: string,
  contentType: ContentType,
): { isFreeShipping: boolean; evidence: string | null } {
  if (contentType === 'markdown') {
    const FREE_RX = /\b(?:frete\s*gr[áa]tis|envio\s*gr[áa]tis|free\s*shipping|free\s*delivery)\b/i;
    const m = content.match(FREE_RX);
    if (m && m[0]) {
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 40);
      const end = Math.min(content.length, idx + m[0].length + 40);
      return { isFreeShipping: true, evidence: content.slice(start, end).trim() };
    }
    return { isFreeShipping: false, evidence: null };
  }
  return detectFreeShipping(content);
}

export async function runSupplierRecipe(
  input: RunSupplierRecipeInput,
): Promise<UniversalSearchResult> {
  // ─── 1. Validar receita ────────────────────────────────────────────
  const v = validateRecipe(input.recipe);
  if (!v.valid) {
    return buildStatusResult('needs_supplier_setup', v.reason);
  }

  const fetcher = input.fetcher ?? createDefaultFetcher();
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minMatchScore = input.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;

  const baseUrl = normalizeBase(input.supplier.site);
  const searchUrl = expandTemplate(
    input.recipe.searchUrlTemplate!,
    input.query,
  );

  try {
    // ─── 2. Buscar página de busca ───────────────────────────────────
    const searchRes = await fetcher.fetchText(searchUrl, { timeoutMs });
    if (searchRes.status !== 'ok' || !searchRes.html) {
      const mapped = fetchStatusToResultStatus(searchRes.status, searchRes.error);
      return buildStatusResult(mapped.status, mapped.message);
    }

    const searchContent = searchRes.content ?? searchRes.html;
    const searchContentType = searchRes.contentType ?? 'html';

    // ─── 3. Extrair candidatos ───────────────────────────────────────
    const { candidates } = extractCandidates({
      searchPageHtml: searchContent,
      searchPageUrl: searchUrl,
      baseUrl,
      maxCandidates,
      contentType: searchContentType,
    });

    if (candidates.length === 0) {
      // Sem candidatos de link — tentar extração direta do conteúdo da busca
      const directExtracted = runExtractors(
        searchContent,
        searchRes.finalUrl ?? searchUrl,
        input.recipe.extractionStrategy,
        searchContentType,
      );
      if (directExtracted?.productName && typeof directExtracted.price === 'number' && directExtracted.price > 0 && directExtracted.currency) {
        const match = matchProduct(input.query, directExtracted.productName);
        if (!match.isAccessory && match.score >= minMatchScore) {
          const freightHint = detectFreeShippingFromContent(searchContent, searchContentType);
          const freight = freightHint.isFreeShipping
            ? { state: 'free_confirmed' as const, value: 0, evidence: freightHint.evidence }
            : { state: 'not_available' as const, value: null, evidence: null };
          return buildValidatedResult({
            productName: directExtracted.productName,
            price: directExtracted.price,
            currency: directExtracted.currency.toUpperCase(),
            productUrl: searchRes.finalUrl ?? searchUrl,
            evidenceText: directExtracted.evidenceText ?? '',
            sourceUrl: searchRes.finalUrl ?? searchUrl,
            strategy: directExtracted.strategy,
            matchScore: match.score,
            confidence: directExtracted.confidence,
            available: directExtracted.available ?? null,
            image: directExtracted.image ?? null,
            freight,
          });
        }
      }
      return buildStatusResult(
        'not_found',
        'sem candidatos a produto na página de busca',
      );
    }

    // ─── 4. Iterar candidatos até achar um validated ─────────────────
    let bestMismatch: { result: UniversalSearchResult; score: number } | null =
      null;
    let sawProductWithoutPrice = false;
    let sawCandidateFetched = false;

    for (const candidate of candidates.slice(0, maxCandidates)) {
      const prodRes = await fetcher.fetchText(candidate.url, { timeoutMs });

      if (prodRes.status === 'blocked' || prodRes.status === 'requires_login') {
        continue;
      }
      if (prodRes.status !== 'ok' || !prodRes.html) continue;
      sawCandidateFetched = true;

      const prodContent = prodRes.content ?? prodRes.html;
      const prodContentType = prodRes.contentType ?? 'html';

      const extracted = runExtractors(
        prodContent,
        prodRes.finalUrl ?? candidate.url,
        input.recipe.extractionStrategy,
        prodContentType,
      );
      if (!extracted) continue;

      if (
        !extracted.productName ||
        extracted.productName.trim() === '' ||
        !extracted.evidenceText
      ) {
        continue;
      }
      if (typeof extracted.price !== 'number' || extracted.price <= 0) {
        sawProductWithoutPrice = true;
        continue;
      }
      if (!extracted.currency || extracted.currency.trim() === '') {
        sawProductWithoutPrice = true;
        continue;
      }

      const productUrl = prodRes.finalUrl ?? candidate.url;

      // ─── 4d. Match score ──────────────────────────────────────────
      const match = matchProduct(input.query, extracted.productName);

      if (match.isAccessory || match.score < minMatchScore) {
        const mismatch = buildMismatchResult({
          productName: extracted.productName,
          productUrl,
          matchScore: match.score,
          reason: match.isAccessory
            ? 'produto parece acessório, query não pediu acessório'
            : `match score ${match.score} abaixo do mínimo ${minMatchScore}`,
        });
        if (!bestMismatch || match.score > bestMismatch.score) {
          bestMismatch = { result: mismatch, score: match.score };
        }
        continue;
      }

      // ─── 4f. Frete ────────────────────────────────────────────────
      const freightHint = detectFreeShippingFromContent(prodContent, prodContentType);
      const freight = freightHint.isFreeShipping
        ? {
            state: 'free_confirmed' as const,
            value: 0,
            evidence: freightHint.evidence,
          }
        : {
            state: 'not_available' as const,
            value: null,
            evidence: null,
          };

      return buildValidatedResult({
        productName: extracted.productName,
        price: extracted.price,
        currency: extracted.currency.toUpperCase(),
        productUrl,
        evidenceText: extracted.evidenceText,
        sourceUrl: productUrl,
        strategy: extracted.strategy,
        matchScore: match.score,
        confidence: extracted.confidence,
        available: extracted.available ?? null,
        image: extracted.image ?? null,
        freight,
      });
    }

    // ─── 5+. Nenhum candidato virou validated ─────────────────────────
    if (bestMismatch) return bestMismatch.result;
    if (sawProductWithoutPrice) {
      return buildStatusResult(
        'price_not_found',
        'produto encontrado em candidato, mas preço/moeda não foram extraídos',
      );
    }
    if (!sawCandidateFetched) {
      return buildStatusResult(
        'blocked',
        'todos os candidatos a produto foram bloqueados',
      );
    }
    return buildStatusResult(
      'invalid_link',
      'candidatos identificados mas nenhum se confirmou como produto',
    );
  } catch (e) {
    const msg = (e as Error).message ?? 'erro inesperado no Recipe Runner';
    const isTimeout = /timeout|tempo esgotado|abort/i.test(msg);
    return buildStatusResult(isTimeout ? 'timeout' : 'error', msg);
  }
}

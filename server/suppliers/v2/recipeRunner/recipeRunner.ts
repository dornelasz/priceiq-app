/**
 * Recipe Runner — executa uma SupplierRecipe certificada e devolve um
 * UniversalSearchResult validado (ou um status controlado de falha).
 *
 * Princípios absolutos:
 *  - NÃO usa Jina, NÃO usa Playwright, NÃO usa Gemini.
 *  - NÃO importa scrapers antigos (server/scrapers/*).
 *  - NÃO chama priceSearchWorker.
 *  - NÃO chama searchService.
 *  - Frete desconhecido NUNCA vira 0 — fica `not_available`.
 *  - Nada é inventado: sem produto+preço+evidência → falha controlada.
 *
 * Fluxo:
 *   1. validateRecipe → needs_supplier_setup se inválida
 *   2. fetch busca → mapeia blocked/login/error/timeout para status V2
 *   3. extractCandidates → not_found se vazio
 *   4. para cada candidato (até maxCandidates):
 *        fetch produto
 *        rodar extractors em ordem (preferida primeiro, depois fallbacks)
 *        validar produto+preço+nome+evidence
 *        matchProduct → mismatch ou validated
 *   5. retorna primeiro validated; senão produto_mismatch/price_not_found/
 *      invalid_link/not_found conforme observado.
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
} from '../fetching/contentFetcher.js';
import {
  EXTRACTORS_IN_ORDER,
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
  /** Match score mínimo para aceitar como validated (default 50). */
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
    // SearchResultStatusV2 não tem requires_login — mapeamos para 'blocked'
    // (semanticamente: o fornecedor está impedindo acesso público ao conteúdo).
    return {
      status: 'blocked',
      message: errorMessage ?? 'fornecedor exige login para acesso',
    };
  }
  if (status === 'not_found') {
    return { status: 'not_found', message: errorMessage ?? 'página não encontrada' };
  }
  // 'error'
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
  html: string,
  candidateUrl: string,
  preferred: ExtractionStrategy | null | undefined,
): ExtractedProductData | null {
  let bestPartial: ExtractedProductData | null = null;
  for (const ex of reorderExtractors(preferred)) {
    const got = ex.extract(html, candidateUrl);
    if (!got) continue;
    if (
      got.productName &&
      typeof got.price === 'number' &&
      got.price > 0
    ) {
      return got; // completo — pode parar
    }
    if (!bestPartial || got.confidence > bestPartial.confidence) {
      bestPartial = got;
    }
  }
  return bestPartial;
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

    // ─── 3. Extrair candidatos ───────────────────────────────────────
    const { candidates } = extractCandidates({
      searchPageHtml: searchRes.html,
      searchPageUrl: searchUrl,
      baseUrl,
      maxCandidates,
    });

    if (candidates.length === 0) {
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
        // Não interrompe a iteração — outro candidato pode estar acessível.
        continue;
      }
      if (prodRes.status !== 'ok' || !prodRes.html) continue;
      sawCandidateFetched = true;

      const extracted = runExtractors(
        prodRes.html,
        prodRes.finalUrl ?? candidate.url,
        input.recipe.extractionStrategy,
      );
      if (!extracted) continue;

      // Sem nome → não há produto identificado
      if (
        !extracted.productName ||
        extracted.productName.trim() === '' ||
        !extracted.evidenceText
      ) {
        continue;
      }
      // Sem preço válido → produto sem preço (price_not_found candidato)
      if (typeof extracted.price !== 'number' || extracted.price <= 0) {
        sawProductWithoutPrice = true;
        continue;
      }
      // Sem moeda → também é falha de extração
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

      // ─── 4f. Frete: só `free_confirmed` quando há evidência clara ─
      const freightHint = detectFreeShipping(prodRes.html);
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

      // ─── Resultado validated ─────────────────────────────────────
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
      // Todos os candidatos vieram blocked/login/erro — não conseguimos abrir nenhum
      return buildStatusResult(
        'blocked',
        'todos os candidatos a produto foram bloqueados',
      );
    }
    // Última possibilidade: links não validáveis como produto
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

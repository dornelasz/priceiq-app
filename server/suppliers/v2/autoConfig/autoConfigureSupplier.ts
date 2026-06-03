/**
 * AutoConfig — orquestrador que tenta configurar um fornecedor sozinho.
 *
 * Não faz scraping de busca real. Não chama o priceSearchWorker. Não
 * chama nenhum scraper antigo. Apenas:
 *  1. carrega o fornecedor
 *  2. marca certification_status = auto_configuring
 *  3. busca homepage / página de busca / página de produto candidata
 *  4. roda detectores puros (plataforma, busca, produto, extrator)
 *  5. monta a receita
 *  6. certifica
 *  7. salva a receita e atualiza o status do fornecedor
 *
 * O Fetcher é injetável para tornar a função testável sem rede.
 * O Store (acesso ao supplierService) também é injetável.
 */
import { supplierService, type Supplier } from '../../../services/supplierService.js';
import { NotFoundError } from '../../../lib/errors.js';
import type {
  SupplierAutoConfigResult,
  SupplierCertificationStatus,
  SupplierRecipe,
} from '../types.js';
import {
  detectPlatform,
  type PlatformDetectorResult,
} from './platformDetector.js';
import {
  discoverSearchUrl,
  type SearchDiscoveryResult,
} from './searchDiscoverer.js';
import {
  detectProductCandidates,
  isLikelyProductPage,
  type ProductCandidate,
  type ProductPageResult,
} from './productPageDetector.js';
import {
  detectExtractionStrategy,
  type ExtractorDetectorResult,
} from './extractorDetector.js';
import { buildSupplierRecipe } from './recipeBuilder.js';
import { certifyRecipeCandidate } from './supplierCertifier.js';

// ─── Fetcher injetável (re-exportado da camada v2/fetching) ─────────────
//
// A definição do Fetcher migrou para v2/fetching/contentFetcher.ts na Fase D
// para ser compartilhada com o Recipe Runner. Mantemos os re-exports aqui
// para preservar a API pública usada pelos testes da Fase C.

import {
  createDefaultFetcher as createDefaultFetcherFromFetching,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type FetcherResult,
  type FetcherStatus,
} from '../fetching/contentFetcher.js';

export type { Fetcher, FetcherResult, FetcherStatus };
export const createDefaultFetcher = createDefaultFetcherFromFetching;

const DEFAULT_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

// ─── Store injetável (interface mínima para teste) ─────────────────────

export interface SupplierStore {
  getSupplier(id: string): Promise<Supplier>;
  upsertRecipe(
    supplierId: string,
    recipe: Partial<SupplierRecipe> & {
      supplierId: string;
      status: SupplierCertificationStatus;
    },
  ): Promise<SupplierRecipe>;
  updateCertificationStatus(
    supplierId: string,
    status: SupplierCertificationStatus,
    opts?: { setAutoConfiguredAt?: boolean },
  ): Promise<void>;
  getRecipe(supplierId: string): Promise<SupplierRecipe | null>;
}

const defaultStore: SupplierStore = {
  getSupplier: (id) => supplierService.get(id),
  upsertRecipe: (id, recipe) => supplierService.upsertRecipe(id, recipe),
  updateCertificationStatus: (id, status, opts) =>
    supplierService.updateCertificationStatus(id, status, opts),
  getRecipe: (id) => supplierService.getRecipe(id),
};

// ─── Opções ─────────────────────────────────────────────────────────────

export interface AutoConfigOptions {
  fetcher?: Fetcher;
  store?: SupplierStore;
  testQuery?: string;
  homepageTimeoutMs?: number;
  searchPageTimeoutMs?: number;
  productPageTimeoutMs?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function normalizeHomepageUrl(site: string): string {
  if (/^https?:\/\//i.test(site)) return site;
  return `https://${site.replace(/^\/+/, '')}`;
}

function expandSearchTemplate(template: string, query: string): string {
  const enc = encodeURIComponent(query);
  return template
    .replace(/\{query\}/gi, enc)
    .replace(/\{q\}/gi, enc)
    .replace(/\{produto\}/gi, enc);
}

// ─── Função principal ──────────────────────────────────────────────────

export async function autoConfigureSupplier(
  supplierId: string,
  options: AutoConfigOptions = {},
): Promise<SupplierAutoConfigResult> {
  const fetcher = options.fetcher ?? createDefaultFetcher();
  const store = options.store ?? defaultStore;
  const testQuery = options.testQuery ?? 'teste';

  // 1. Carrega supplier (NotFoundError sobe naturalmente)
  const supplier = await store.getSupplier(supplierId);

  // 2. Marca auto_configuring (best-effort; se falhar, segue)
  await store
    .updateCertificationStatus(supplierId, 'auto_configuring')
    .catch(() => {});

  try {
    // 3. Homepage
    const homepageUrl = normalizeHomepageUrl(supplier.site);
    const homepageRes = await fetcher.fetchText(homepageUrl, {
      timeoutMs: options.homepageTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    let blocked = homepageRes.status === 'blocked';
    let requiresLogin = homepageRes.status === 'requires_login';
    const homepageFailed = homepageRes.status === 'error';
    const homepageHtml = homepageRes.html ?? '';

    // 4. Plataforma
    const platform: PlatformDetectorResult = detectPlatform({
      baseUrl: homepageUrl,
      homepageHtml,
    });

    // 5. URL de busca
    const search: SearchDiscoveryResult = discoverSearchUrl({
      baseUrl: homepageUrl,
      homepageHtml,
      platformDetected: platform.platformDetected,
      legacyTemplate: supplier.search_url_template || null,
      testQuery,
    });

    // 6+7. Busca → candidatos
    let candidates: ProductCandidate[] = [];
    if (!blocked && !requiresLogin && search.searchUrlTemplate) {
      const searchUrl = expandSearchTemplate(
        search.searchUrlTemplate,
        testQuery,
      );
      const searchRes = await fetcher.fetchText(searchUrl, {
        timeoutMs: options.searchPageTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (searchRes.status === 'blocked') blocked = true;
      else if (searchRes.status === 'requires_login') requiresLogin = true;
      else if (searchRes.status === 'ok' && searchRes.html) {
        candidates = detectProductCandidates({
          searchPageHtml: searchRes.html,
          searchPageUrl: searchUrl,
          baseUrl: homepageUrl,
        }).candidates;
      }
    }

    // 8+9+10. Página de produto + estratégia
    let productPage: ProductPageResult | null = null;
    let extractor: ExtractorDetectorResult = {
      extractionStrategy: null,
      confidence: 0,
      signals: [],
      jsonLdEnabled: false,
      requiresJs: false,
      requiresBrowser: false,
    };
    if (!blocked && !requiresLogin && candidates.length > 0) {
      const top = candidates[0]!;
      const prodRes = await fetcher.fetchText(top.url, {
        timeoutMs: options.productPageTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (prodRes.status === 'blocked') blocked = true;
      else if (prodRes.status === 'requires_login') requiresLogin = true;
      else if (prodRes.status === 'ok' && prodRes.html) {
        productPage = isLikelyProductPage({
          html: prodRes.html,
          url: top.url,
        });
        extractor = detectExtractionStrategy({
          productPageHtml: prodRes.html,
          productPageUrl: top.url,
        });
      }
    }

    // 11. Monta receita
    const recipeDraft = buildSupplierRecipe({
      supplierId,
      platform,
      search,
      productPage,
      productCandidates: candidates,
      extractor,
      legacyTemplate: supplier.search_url_template || null,
      blocked,
      requiresLogin,
      lastError: homepageFailed
        ? homepageRes.error ?? 'falha ao baixar homepage'
        : null,
    });

    // 12. Certifica
    const cert = certifyRecipeCandidate({
      recipe: recipeDraft,
      discovery: {
        hasSearchUrl: !!search.searchUrlTemplate,
        searchConfidence: search.confidence,
        hasProductSignal: !!productPage?.isProductPage,
        productConfidence: productPage?.confidence ?? 0,
        hasExtractionStrategy: !!extractor.extractionStrategy,
        extractorConfidence: extractor.confidence,
        blocked,
        requiresLogin,
        fetchFailed: homepageFailed,
      },
    });

    // 13. Persiste receita com status final
    const savedRecipe = await store.upsertRecipe(supplierId, {
      ...recipeDraft,
      status: cert.status,
      confidence: cert.confidence,
    });

    // 14. Atualiza status do supplier
    const setAutoConfiguredAt =
      cert.status === 'certified' || cert.status === 'needs_guided_setup';
    await store.updateCertificationStatus(supplierId, cert.status, {
      setAutoConfiguredAt,
    });

    // 15. Retorno
    return {
      supplierId,
      status: cert.status,
      platformDetected: platform.platformDetected,
      searchUrlTemplate: search.searchUrlTemplate,
      confidence: cert.confidence,
      error: cert.reason ?? null,
      recipe: savedRecipe,
    };
  } catch (e) {
    // Erro inesperado dentro do fluxo → failed (best-effort de persistência)
    const errMsg = (e as Error).message ?? 'erro desconhecido durante autoconfig';
    await store
      .updateCertificationStatus(supplierId, 'failed')
      .catch(() => {});
    await store
      .upsertRecipe(supplierId, {
        supplierId,
        status: 'failed',
        lastError: errMsg,
        lastTestedAt: new Date().toISOString(),
        configJson: { autoConfig: { unexpectedError: errMsg } },
      })
      .catch(() => {});
    return {
      supplierId,
      status: 'failed',
      platformDetected: null,
      searchUrlTemplate: null,
      confidence: 0,
      error: errMsg,
      recipe: null,
    };
  }
}

// Re-exporta NotFoundError para os consumers da rota poderem mapear 404.
export { NotFoundError };

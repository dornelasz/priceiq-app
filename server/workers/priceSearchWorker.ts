/**
 * Worker in-process — orquestra a busca real para uma search criada.
 *
 * Fluxo V2 por fornecedor (a partir da Fase E):
 *   1. Cache: se cache hit válido (status='validated', tem produto+preço+
 *      evidence+linkValidated), reaproveita como `cached`.
 *   2. Carrega `supplier_recipes` via supplierService.getRecipe.
 *   3. Se recipe.status='certified' → runSupplierRecipe(supplier, recipe, query).
 *   4. Se recipe não certified → autoConfigureSupplier(supplier.id) UMA vez.
 *      Se autoConfig retornar certified com recipe nova → runSupplierRecipe.
 *      Caso contrário → grava status controlado (`needs_supplier_setup`
 *      mapeado para 'error' com errorMessage explícito).
 *   5. Persiste o UniversalSearchResult via mapUniversalResultToInsertPayload.
 *   6. Cache: só armazena resultados que passam por isCacheValid (validated
 *      com price+productName+evidence+link). Erros NUNCA entram no cache.
 *
 * Garantias mantidas da Fase D:
 *   - Frete desconhecido NUNCA vira 0 (freight=null, totalPrice=null).
 *   - Sem evidence → resultado nunca é gravado como validated.
 *   - Link de busca/categoria nunca é gravado como product validado.
 *   - Cotação continua vindo do searchService.convertToBrl (sem tocar em
 *     currencyService nem em routes/rates).
 *   - Falha isolada: exception em um fornecedor não derruba os outros.
 *
 * Concorrência: SEARCH_CONCURRENCY do config.
 * Ao final: searchService.finalizeStatus → completed/partial_failed/failed.
 */
import { config } from '../config.js';
import { searchService } from '../services/searchService.js';
import { supplierService, type Supplier } from '../services/supplierService.js';
import { cacheService } from '../services/cacheService.js';
import { matchingService } from '../services/matchingService.js';
import type { ResultStatus } from '../lib/resultStatus.js';
import { autoConfigureSupplier } from '../suppliers/v2/autoConfig/index.js';
import { runSupplierRecipe } from '../suppliers/v2/recipeRunner/index.js';
import { mapUniversalResultToInsertPayload } from '../suppliers/v2/integration/index.js';
import type {
  SupplierRecipe,
  UniversalSearchResult,
  Fetcher,
} from '../suppliers/v2/index.js';

export interface WorkerInput {
  searchId: string;
  query: string;
  suppliers: Supplier[];
  forceRefresh: boolean;
  /** Injetáveis para teste. Em produção, defaults são usados. */
  deps?: WorkerDeps;
}

/**
 * Dependências injetáveis — permite testar o worker sem rede e sem DB.
 * Em produção, todos os defaults são os módulos reais.
 */
export interface WorkerDeps {
  fetcher?: Fetcher;
  getRecipe?: (supplierId: string) => Promise<SupplierRecipe | null>;
  autoConfigure?: typeof autoConfigureSupplier;
  runRecipe?: typeof runSupplierRecipe;
  insertResult?: typeof searchService.insertResult;
  markRunning?: typeof searchService.markRunning;
  finalizeStatus?: typeof searchService.finalizeStatus;
  convertToBrl?: typeof searchService.convertToBrl;
  cacheGet?: <T>(supplierId: string, key: string) => Promise<T | null>;
  cacheSet?: (supplierId: string, key: string, value: unknown) => Promise<void>;
}

interface CachedResult {
  status: ResultStatus;
  productName?: string;
  price?: number;
  currency?: string;
  productUrl?: string;
  linkType?: 'product' | 'search' | 'unverified';
  linkValidated?: boolean;
  evidenceText?: string;
  sourceUrl?: string;
  sourceName?: string;
  freightStatus?: 'not_available' | 'free_confirmed' | 'confirmed' | 'estimated';
  freight?: number | null;
  available?: boolean;
  cachedAt: string;
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Array<Promise<void>> = [];
  const workerCount = Math.min(limit, items.length);
  for (let w = 0; w < workerCount; w++) {
    runners.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) break;
          try {
            await task(items[i] as T, i);
          } catch (e) {
            console.error('[worker] task escapou:', e);
          }
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/**
 * Porta de qualidade do cache. Erros e resultados sem evidência NUNCA
 * podem entrar/sair do cache como se fossem validated.
 */
export function isCacheValid(c: CachedResult | null | undefined): boolean {
  if (!c) return false;
  if (c.status !== 'validated') return false;
  if (typeof c.price !== 'number' || !Number.isFinite(c.price) || c.price <= 0) return false;
  if (!c.productName || c.productName.trim() === '') return false;
  if (!c.currency || c.currency.trim() === '') return false;
  if (!c.productUrl || c.productUrl.trim() === '') return false;
  if (c.linkType !== 'product') return false;
  if (c.linkValidated !== true) return false;
  if (!c.evidenceText || c.evidenceText.trim() === '') return false;
  return true;
}

function universalToCacheable(u: UniversalSearchResult): CachedResult {
  return {
    status: 'validated',
    productName: u.productName,
    price: u.price ?? undefined,
    currency: u.currency ?? undefined,
    productUrl: u.productUrl ?? undefined,
    linkType: u.linkType === 'product' && u.linkValidated ? 'product' : 'unverified',
    linkValidated: u.linkValidated,
    evidenceText: u.evidence?.evidenceText,
    sourceUrl: u.evidence?.sourceUrl,
    sourceName: 'v2_recipe_runner',
    freightStatus: u.freightStatus,
    freight: u.freight ?? null,
    available: u.available ?? undefined,
    cachedAt: new Date().toISOString(),
  };
}

function cachedToUniversal(c: CachedResult): UniversalSearchResult {
  return {
    found: true,
    status: 'validated',
    productName: c.productName,
    price: c.price ?? null,
    currency: c.currency ?? null,
    freight: c.freight ?? null,
    freightStatus: c.freightStatus ?? 'not_available',
    totalPrice: null,
    productUrl: c.productUrl ?? null,
    linkType: c.linkType === 'product' ? 'product' : 'unknown',
    linkValidated: c.linkValidated ?? false,
    matchScore: null,
    confidence: null,
    available: c.available ?? null,
    warning: null,
    errorMessage: null,
    evidence: c.evidenceText && c.sourceUrl
      ? {
          sourceUrl: c.sourceUrl,
          sourceName: c.sourceName,
          evidenceText: c.evidenceText,
          extractedAt: c.cachedAt,
          strategy: 'json_ld',
        }
      : null,
  };
}

export async function runSearchWorker(input: WorkerInput): Promise<void> {
  const { searchId, query, suppliers, forceRefresh } = input;
  const deps = input.deps ?? {};
  const normalizedQuery = matchingService.cacheKey(query);

  const getRecipe = deps.getRecipe ?? ((id) => supplierService.getRecipe(id));
  const doAutoConfigure = deps.autoConfigure ?? autoConfigureSupplier;
  const doRunRecipe = deps.runRecipe ?? runSupplierRecipe;
  const doInsertResult = deps.insertResult ?? searchService.insertResult.bind(searchService);
  const doMarkRunning = deps.markRunning ?? searchService.markRunning.bind(searchService);
  const doFinalize = deps.finalizeStatus ?? searchService.finalizeStatus.bind(searchService);
  const doConvert = deps.convertToBrl ?? searchService.convertToBrl.bind(searchService);
  const doCacheGet =
    deps.cacheGet ??
    (<T>(id: string, k: string) => cacheService.getSupplierResult<T>(id, k));
  const doCacheSet =
    deps.cacheSet ?? ((id, k, v) => cacheService.setSupplierResult(id, k, v));

  if (suppliers.length === 0) {
    await doFinalize(searchId);
    return;
  }

  await doMarkRunning(searchId).catch(() => {});

  await withConcurrency(suppliers, config.SEARCH_CONCURRENCY, async (sup) => {
    const t0 = Date.now();
    let route = 'unknown';

    try {
      // ─── 1. Cache (porta de qualidade estrita) ─────────────────────
      if (config.ENABLE_SEARCH_CACHE && !forceRefresh) {
        const cached = await doCacheGet<CachedResult>(sup.id, normalizedQuery).catch(
          () => null,
        );
        if (cached && isCacheValid(cached)) {
          route = 'cache';
          const universal = cachedToUniversal(cached);
          const payload = await mapUniversalResultToInsertPayload({
            result: universal,
            convertToBrl: doConvert,
            sourceName: cached.sourceName ?? 'v2_recipe_runner',
            fromCache: true,
          });
          await doInsertResult(searchId, sup, payload);
          console.log(
            `[worker] ${sup.name} | route: ${route} | status: ${payload.status} | elapsed: ${Date.now() - t0}ms`,
          );
          return;
        }
      }

      // ─── 2. Carrega recipe ─────────────────────────────────────────
      let recipe: SupplierRecipe | null = await getRecipe(sup.id).catch(() => null);

      // ─── 3. AutoConfig se receita não certificada ──────────────────
      if (!recipe || recipe.status !== 'certified') {
        try {
          const autoResult = await doAutoConfigure(sup.id);
          if (autoResult.status === 'certified' && autoResult.recipe) {
            recipe = autoResult.recipe;
            route = 'autoconfig_then_recipe';
          } else {
            const reason = autoResult.error ?? autoResult.status;
            await doInsertResult(searchId, sup, {
              found: false,
              status: 'error',
              errorMessage: `needs_supplier_setup: ${reason}`,
              fromCache: false,
              sourceName: 'v2_autoconfig',
            });
            console.log(
              `[worker] ${sup.name} | route: autoconfig_not_certified | status: needs_supplier_setup(${autoResult.status}) | elapsed: ${Date.now() - t0}ms`,
            );
            return;
          }
        } catch (e) {
          const msg = (e as Error).message ?? 'autoconfig falhou';
          await doInsertResult(searchId, sup, {
            found: false,
            status: 'error',
            errorMessage: `needs_supplier_setup: autoConfig exception: ${msg}`,
            fromCache: false,
            sourceName: 'v2_autoconfig_error',
          });
          console.log(
            `[worker] ${sup.name} | route: autoconfig_error | status: error | elapsed: ${Date.now() - t0}ms`,
          );
          return;
        }
      } else {
        route = 'recipe';
      }

      // ─── 4. Executa recipe ─────────────────────────────────────────
      const v2Result: UniversalSearchResult = await doRunRecipe({
        supplier: sup,
        recipe: recipe!,
        query,
        ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
        timeoutMs: config.SUPPLIER_TIMEOUT_MS,
      });

      // ─── 5. Persiste resultado ─────────────────────────────────────
      const payload = await mapUniversalResultToInsertPayload({
        result: v2Result,
        convertToBrl: doConvert,
        sourceName: 'v2_recipe_runner',
        fromCache: false,
      });
      await doInsertResult(searchId, sup, payload);

      // ─── 6. Cache (só validated com isCacheValid passando) ────────
      if (v2Result.status === 'validated' && payload.status === 'validated') {
        const toCache = universalToCacheable(v2Result);
        if (isCacheValid(toCache)) {
          void doCacheSet(sup.id, normalizedQuery, toCache).catch((e) =>
            console.warn('[worker] cache set falhou', e),
          );
        }
      }

      console.log(
        `[worker] ${sup.name} | route: ${route} | status: ${payload.status} | elapsed: ${Date.now() - t0}ms`,
      );
    } catch (e) {
      const msg = (e as Error).message ?? 'erro inesperado no worker';
      console.error('[worker] supplier task falhou', sup.name, e);
      try {
        await doInsertResult(searchId, sup, {
          found: false,
          status: 'error',
          errorMessage: `V2 worker: ${msg.slice(0, 200)}`,
          fromCache: false,
          sourceName: 'v2_worker_error',
        });
      } catch (e2) {
        console.error('[worker] insertResult fallback falhou', sup.name, e2);
      }
    }
  });

  // ─── Finaliza status da busca ──────────────────────────────────────
  try {
    await doFinalize(searchId);
  } catch (e) {
    console.error('[worker] finalizeStatus falhou', e);
  }
}

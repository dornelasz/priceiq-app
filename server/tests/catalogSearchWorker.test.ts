/**
 * Etapa 18 — priceSearchWorker conectado ao catalog-first search.
 *
 * runCatalogSearch é INJETADO (mock) — nenhuma rede real, nenhum Firecrawl,
 * nenhum DB, nenhuma IA/Gemini. O fluxo de recipe (fallback) também é mockado.
 *
 * Cobre:
 *  - validated vindo do catalog-first é persistido como validated
 *  - partial vindo do catalog-first é persistido como partial (frete null, não 0)
 *  - blocked (failures) é persistido como blocked
 *  - falha técnica (status='failed' ou exception) → fallback ao recipe
 *  - sem usefulResults com falhas → falha controlada
 *  - no_candidates → not_found controlado (sem fallback)
 *  - catalog-first desligado → usa recipe direto
 *  - Firecrawl/IA nunca são chamados (mock é o único caminho)
 *  - mapCatalogSearchResultToPayload / pickBestUseful (funções puras)
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const { runSearchWorker } = await import('../workers/priceSearchWorker.js');
const { mapCatalogSearchResultToPayload, pickBestUseful, pickRepresentativeFailure } =
  await import('../suppliers/v2/integration/index.js');
const { cacheService } = await import('../services/cacheService.js');
const { closePool } = await import('../db/client.js');

import type { Supplier } from '../services/supplierService.js';
import type { SupplierRecipe, UniversalSearchResult } from '../suppliers/v2/index.js';
import type { InsertResultPayload } from '../services/searchService.js';
import type { WorkerDeps } from '../workers/priceSearchWorker.js';
import type {
  CatalogSearchResult,
  UsefulResult,
  FailedResult,
} from '../suppliers/v2/searchEngine/catalogSearch/index.js';

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

// ─── Fixtures ────────────────────────────────────────────────────────────

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    name: 'Loja Teste',
    site: 'loja.com',
    search_url_template: '',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: '2026-05-22T10:00:00.000Z',
    updated_at: '2026-05-22T10:00:00.000Z',
    certificationStatus: 'certified',
    setupStatus: 'certified',
    autoConfiguredAt: '2026-05-22T11:00:00.000Z',
    recipe: null,
    ...over,
  };
}

function makeRecipe(over: Partial<SupplierRecipe> = {}): SupplierRecipe {
  return {
    supplierId: 'sup-1',
    status: 'certified',
    platformDetected: 'custom',
    searchUrlTemplate: 'https://loja.com/search?q={query}',
    productUrlPatterns: ['/products/<id>'],
    extractionStrategy: 'json_ld',
    jsonLdEnabled: true,
    requiresJs: false,
    requiresBrowser: false,
    confidence: 80,
    ...over,
  };
}

function makeUseful(over: Partial<UsefulResult> = {}): UsefulResult {
  return {
    candidateId: 'c1',
    productUrl: 'https://loja.com/products/notebook',
    productName: 'Notebook Dell Inspiron 15 i5',
    price: 4599.9,
    currency: 'BRL',
    priceBrl: 4599.9,
    freight: 0,
    freightStatus: 'free_confirmed',
    totalBrl: 4599.9,
    matchScore: 85,
    confidence: 90,
    evidenceText: 'JSON-LD Product · price=4599.9 BRL',
    status: 'validated',
    matchStatus: 'confirmed',
    ...over,
  };
}

function makeCatalogResult(over: Partial<CatalogSearchResult> = {}): CatalogSearchResult {
  return {
    supplierId: 'sup-1',
    query: 'notebook dell',
    normalizedQuery: 'notebook dell',
    status: 'completed',
    strategy: 'reused_matches',
    reusedMatchesCount: 1,
    candidatesDiscovered: 0,
    candidatesProcessed: 1,
    matchesCreated: 0,
    usefulResults: [],
    failures: [],
    attempts: [],
    diagnostics: {
      reusableMatchesFound: 1,
      candidatesDiscoveredBySource: {},
      processingStatusBreakdown: {},
      attemptCount: 0,
    },
    errors: [],
    ...over,
  };
}

function makeValidatedUniversal(
  over: Partial<UniversalSearchResult> = {},
): UniversalSearchResult {
  return {
    found: true,
    status: 'validated',
    productName: 'Recipe Fallback Notebook',
    price: 1000,
    currency: 'BRL',
    freight: 0,
    freightStatus: 'free_confirmed',
    totalPrice: 1000,
    productUrl: 'https://loja.com/products/fallback',
    linkType: 'product',
    linkValidated: true,
    matchScore: 80,
    confidence: 90,
    available: true,
    warning: null,
    errorMessage: null,
    evidence: {
      sourceUrl: 'https://loja.com/products/fallback',
      sourceName: 'v2_recipe_runner',
      evidenceText: 'JSON-LD Product · price=1000 BRL',
      extractedAt: '2026-05-22T12:00:00.000Z',
      strategy: 'json_ld',
    },
    ...over,
  };
}

interface Harness {
  inserts: InsertResultPayload[];
  catalogCalls: number;
  recipeRunCalls: number;
}

function makeWorkerDeps(opts: {
  catalogResult?: CatalogSearchResult;
  catalogThrows?: Error;
  catalogSearchEnabled?: boolean;
  recipe?: SupplierRecipe | null;
  recipeResult?: UniversalSearchResult;
}): { deps: WorkerDeps; harness: Harness } {
  const harness: Harness = { inserts: [], catalogCalls: 0, recipeRunCalls: 0 };

  const deps: WorkerDeps = {
    catalogSearchEnabled: opts.catalogSearchEnabled ?? true,
    getRecipe: async () => opts.recipe ?? makeRecipe(),
    runCatalogSearch: (async (): Promise<CatalogSearchResult> => {
      harness.catalogCalls += 1;
      if (opts.catalogThrows) throw opts.catalogThrows;
      return opts.catalogResult ?? makeCatalogResult();
    }) as WorkerDeps['runCatalogSearch'],
    runRecipe: (async (): Promise<UniversalSearchResult> => {
      harness.recipeRunCalls += 1;
      return opts.recipeResult ?? makeValidatedUniversal();
    }) as unknown as WorkerDeps['runRecipe'],
    autoConfigure: (async (id: string) => ({
      supplierId: id,
      status: 'certified' as const,
      platformDetected: 'custom',
      searchUrlTemplate: 'https://loja.com/search?q={query}',
      confidence: 80,
      recipe: makeRecipe(),
    })) as unknown as WorkerDeps['autoConfigure'],
    insertResult: (async (_sid: string, _sup: Supplier, payload: InsertResultPayload) => {
      harness.inserts.push(payload);
    }) as WorkerDeps['insertResult'],
    markRunning: (async () => {}) as WorkerDeps['markRunning'],
    finalizeStatus: (async () => ({
      status: 'completed' as const,
      best: { supplier: null, totalBrl: null },
    })) as WorkerDeps['finalizeStatus'],
    convertToBrl: (async (amount: number, currency: string) => {
      if (currency === 'BRL') return { brl: amount, rate: 1 };
      return { brl: parseFloat((amount * 5).toFixed(4)), rate: 5 };
    }) as WorkerDeps['convertToBrl'],
    cacheGet: (async () => null) as WorkerDeps['cacheGet'],
    cacheSet: (async () => {}) as WorkerDeps['cacheSet'],
  };
  return { deps, harness };
}

async function run(deps: WorkerDeps): Promise<void> {
  await runSearchWorker({
    searchId: 's1',
    query: 'notebook dell',
    suppliers: [makeSupplier()],
    forceRefresh: false,
    deps,
  });
}

// ─── Worker + catalog-first ────────────────────────────────────────────────

describe('worker catalog-first — resultados úteis', () => {
  it('validated do catalog-first → persiste validated, NÃO chama recipe', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({ usefulResults: [makeUseful()] }),
    });
    await run(deps);

    assert.equal(harness.catalogCalls, 1);
    assert.equal(harness.recipeRunCalls, 0, 'recipe não deve ser chamado');
    assert.equal(harness.inserts.length, 1);
    const p = harness.inserts[0]!;
    assert.equal(p.status, 'validated');
    assert.equal(p.found, true);
    assert.equal(p.price, 4599.9);
    assert.equal(p.totalBrl, 4599.9);
    assert.equal(p.priceBrl, 4599.9);
    assert.equal(p.productUrl, 'https://loja.com/products/notebook');
    assert.ok(p.evidenceText, 'evidência preservada');
    assert.equal(p.sourceName, 'catalog_search');
  });

  it('partial do catalog-first → persiste partial, frete null (NÃO 0), priceBrl presente', async () => {
    const partialUseful = makeUseful({
      status: 'partial',
      freight: null,
      freightStatus: 'not_available',
      totalBrl: null,
      matchStatus: 'pending',
    });
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({
        status: 'completed',
        usefulResults: [partialUseful],
      }),
    });
    await run(deps);

    const p = harness.inserts[0]!;
    assert.equal(p.status, 'partial');
    assert.equal(p.freight, undefined, 'frete desconhecido nunca vira 0');
    assert.notEqual(p.freight, 0);
    assert.equal(p.totalPrice, undefined);
    assert.equal(p.totalBrl, undefined);
    assert.equal(p.priceBrl, 4599.9, 'preço convertido continua disponível');
    assert.equal(harness.recipeRunCalls, 0);
  });

  it('escolhe o melhor usefulResult (validated antes de partial)', async () => {
    const partial = makeUseful({
      candidateId: 'c-partial',
      status: 'partial',
      freightStatus: 'not_available',
      freight: null,
      price: 100,
      matchScore: 95,
    });
    const validated = makeUseful({
      candidateId: 'c-valid',
      status: 'validated',
      price: 200,
      matchScore: 60,
    });
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({ usefulResults: [partial, validated] }),
    });
    await run(deps);
    // validated vence partial mesmo com matchScore menor → status validated
    assert.equal(harness.inserts[0]!.status, 'validated');
    assert.equal(harness.inserts[0]!.price, 200);
  });
});

describe('worker catalog-first — falhas controladas', () => {
  it('blocked (failures) → persiste blocked', async () => {
    const failure: FailedResult = {
      candidateId: 'c1',
      productUrl: 'https://loja.com/products/x',
      status: 'blocked',
    };
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({
        status: 'no_matches',
        usefulResults: [],
        failures: [failure],
      }),
    });
    await run(deps);
    assert.equal(harness.inserts[0]!.status, 'blocked');
    assert.equal(harness.inserts[0]!.found, false);
    assert.equal(harness.recipeRunCalls, 0, 'falha controlada NÃO faz fallback');
  });

  it('product_mismatch (failures) → persiste product_mismatch sem inventar produto', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({
        status: 'no_matches',
        usefulResults: [],
        failures: [
          { candidateId: 'c1', productUrl: 'https://loja.com/x', status: 'product_mismatch' },
        ],
      }),
    });
    await run(deps);
    const p = harness.inserts[0]!;
    assert.equal(p.status, 'product_mismatch');
    assert.equal(p.productName, undefined);
    assert.equal(p.price, undefined);
  });

  it('no_candidates → not_found controlado, sem fallback', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({
        status: 'no_candidates',
        usefulResults: [],
        failures: [],
        recommendation: 'rode discover-catalog primeiro',
      }),
    });
    await run(deps);
    assert.equal(harness.inserts[0]!.status, 'not_found');
    assert.equal(harness.recipeRunCalls, 0);
  });
});

describe('worker catalog-first — fallback seguro', () => {
  it('status=failed (falha técnica) → fallback ao recipe', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogResult: makeCatalogResult({ status: 'failed', errors: [{ message: 'db down' }] }),
      recipeResult: makeValidatedUniversal(),
    });
    await run(deps);
    assert.equal(harness.catalogCalls, 1);
    assert.equal(harness.recipeRunCalls, 1, 'fallback ao recipe deve rodar');
    // recipe retornou validated com free_confirmed → status validated
    assert.equal(harness.inserts[0]!.status, 'validated');
    assert.equal(harness.inserts[0]!.productName, 'Recipe Fallback Notebook');
  });

  it('exception no catalog-first → fallback ao recipe', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogThrows: new Error('catalog explodiu'),
      recipeResult: makeValidatedUniversal(),
    });
    await run(deps);
    assert.equal(harness.recipeRunCalls, 1);
    assert.equal(harness.inserts[0]!.status, 'validated');
  });

  it('catalogSearchEnabled=false → usa recipe direto, NÃO chama catalog', async () => {
    const { deps, harness } = makeWorkerDeps({
      catalogSearchEnabled: false,
      recipeResult: makeValidatedUniversal(),
    });
    await run(deps);
    assert.equal(harness.catalogCalls, 0, 'catalog-first não deve ser chamado');
    assert.equal(harness.recipeRunCalls, 1);
  });
});

// ─── Adapter puro ────────────────────────────────────────────────────────

describe('mapCatalogSearchResultToPayload (puro)', () => {
  const convertToBrl = async (amount: number, currency: string) =>
    currency === 'BRL' ? { brl: amount, rate: 1 } : { brl: amount * 5, rate: 5 };

  it('validated + free_confirmed → payload validated com totalBrl', async () => {
    const out = await mapCatalogSearchResultToPayload(
      makeCatalogResult({ usefulResults: [makeUseful()] }),
      { convertToBrl },
    );
    assert.equal(out.fallback, false);
    assert.equal(out.payload!.status, 'validated');
    assert.equal(out.payload!.totalBrl, 4599.9);
    assert.ok(out.universal, 'universal reconstruído para cache');
  });

  it('partial (not_available) → payload partial, frete null', async () => {
    const out = await mapCatalogSearchResultToPayload(
      makeCatalogResult({
        usefulResults: [
          makeUseful({ status: 'partial', freight: null, freightStatus: 'not_available', totalBrl: null }),
        ],
      }),
      { convertToBrl },
    );
    assert.equal(out.payload!.status, 'partial');
    assert.equal(out.payload!.freight, undefined);
    assert.equal(out.payload!.totalBrl, undefined);
  });

  it('moeda USD → converte priceBrl/totalBrl via convertToBrl', async () => {
    const out = await mapCatalogSearchResultToPayload(
      makeCatalogResult({
        usefulResults: [
          makeUseful({ currency: 'USD', price: 100, priceBrl: null, freight: 0, freightStatus: 'free_confirmed', totalBrl: null }),
        ],
      }),
      { convertToBrl },
    );
    assert.equal(out.payload!.status, 'validated');
    assert.equal(out.payload!.priceBrl, 500);
    assert.equal(out.payload!.totalBrl, 500);
    assert.equal(out.payload!.exchangeRateUsed, 5);
  });

  it('status=failed → fallback=true, payload=null', async () => {
    const out = await mapCatalogSearchResultToPayload(
      makeCatalogResult({ status: 'failed' }),
      { convertToBrl },
    );
    assert.equal(out.fallback, true);
    assert.equal(out.payload, null);
  });

  it('no_matches só com failures → falha controlada (sem fallback)', async () => {
    const out = await mapCatalogSearchResultToPayload(
      makeCatalogResult({
        status: 'no_matches',
        failures: [{ candidateId: 'c1', productUrl: 'https://loja.com/x', status: 'price_not_found' }],
      }),
      { convertToBrl },
    );
    assert.equal(out.fallback, false);
    assert.equal(out.payload!.status, 'price_not_found');
  });
});

describe('pickBestUseful / pickRepresentativeFailure (puros)', () => {
  it('pickBestUseful prioriza validated sobre partial', () => {
    const best = pickBestUseful([
      makeUseful({ status: 'partial', matchScore: 99 }),
      makeUseful({ status: 'validated', matchScore: 50 }),
    ]);
    assert.equal(best!.status, 'validated');
  });

  it('pickBestUseful vazio → null', () => {
    assert.equal(pickBestUseful([]), null);
  });

  it('pickRepresentativeFailure prioriza blocked', () => {
    const f = pickRepresentativeFailure([
      { candidateId: 'a', productUrl: 'u', status: 'error' },
      { candidateId: 'b', productUrl: 'u', status: 'blocked' },
      { candidateId: 'c', productUrl: 'u', status: 'price_not_found' },
    ]);
    assert.equal(f!.status, 'blocked');
  });
});

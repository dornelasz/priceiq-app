/**
 * Testes do priceSearchWorker conectado ao V2 (Fase E).
 *
 * Todos os caminhos do worker são exercidos via dependency injection:
 *  - getRecipe, autoConfigure, runRecipe, convertToBrl, cacheGet, cacheSet
 *  - insertResult / markRunning / finalizeStatus
 *
 * Nenhum teste depende de internet, DB real ou Redis. Apenas mocks.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { runSearchWorker, isCacheValid } = await import(
  '../workers/priceSearchWorker.js'
);
const { mapUniversalResultToInsertPayload, mapV2StatusToLegacy } =
  await import('../suppliers/v2/integration/index.js');

type Supplier = import('../services/supplierService.js').Supplier;
type SupplierRecipe = import('../suppliers/v2/index.js').SupplierRecipe;
type UniversalSearchResult =
  import('../suppliers/v2/index.js').UniversalSearchResult;
type InsertResultPayload =
  import('../services/searchService.js').InsertResultPayload;
type WorkerDeps = import('../workers/priceSearchWorker.js').WorkerDeps;
type SupplierAutoConfigResult =
  import('../suppliers/v2/index.js').SupplierAutoConfigResult;

// ─── Helpers ────────────────────────────────────────────────────────────

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

function makeValidatedUniversal(
  over: Partial<UniversalSearchResult> = {},
): UniversalSearchResult {
  return {
    found: true,
    status: 'validated',
    productName: 'Notebook Dell Inspiron 15 i5',
    price: 4599.9,
    currency: 'BRL',
    freight: null,
    freightStatus: 'not_available',
    totalPrice: null,
    productUrl: 'https://loja.com/products/notebook',
    linkType: 'product',
    linkValidated: true,
    matchScore: 80,
    confidence: 90,
    available: true,
    warning: null,
    errorMessage: null,
    evidence: {
      sourceUrl: 'https://loja.com/products/notebook',
      sourceName: 'v2_recipe_runner',
      evidenceText: 'JSON-LD Product · price=4599.9 BRL',
      extractedAt: '2026-05-22T12:00:00.000Z',
      strategy: 'json_ld',
    },
    ...over,
  };
}

interface RecordedInsert {
  searchId: string;
  supplierId: string;
  payload: InsertResultPayload;
}

interface MockHarness {
  inserts: RecordedInsert[];
  recipeCalls: string[];
  autoConfigCalls: string[];
  recipeRunCalls: Array<{ supplierId: string; query: string }>;
  finalizeCalls: string[];
  markRunningCalls: string[];
  cacheGetCalls: Array<{ supplierId: string; key: string }>;
  cacheSetCalls: Array<{ supplierId: string; key: string; value: unknown }>;
}

function makeDeps(opts: {
  recipes?: Record<string, SupplierRecipe | null>;
  autoResults?: Record<string, SupplierAutoConfigResult>;
  recipeResults?: Record<string, UniversalSearchResult>;
  recipeThrows?: Record<string, Error>;
  autoThrows?: Record<string, Error>;
  cache?: Record<string, unknown>;
  rate?: number;
}): { deps: WorkerDeps; harness: MockHarness } {
  const harness: MockHarness = {
    inserts: [],
    recipeCalls: [],
    autoConfigCalls: [],
    recipeRunCalls: [],
    finalizeCalls: [],
    markRunningCalls: [],
    cacheGetCalls: [],
    cacheSetCalls: [],
  };
  const cacheStore = new Map<string, unknown>();
  for (const [k, v] of Object.entries(opts.cache ?? {})) cacheStore.set(k, v);

  const deps: WorkerDeps = {
    getRecipe: async (id) => {
      harness.recipeCalls.push(id);
      return opts.recipes?.[id] ?? null;
    },
    autoConfigure: (async (id: string): Promise<SupplierAutoConfigResult> => {
      harness.autoConfigCalls.push(id);
      if (opts.autoThrows?.[id]) throw opts.autoThrows[id];
      return (
        opts.autoResults?.[id] ?? {
          supplierId: id,
          status: 'unsupported',
          platformDetected: null,
          searchUrlTemplate: null,
          confidence: 0,
          error: 'sem fixture',
          recipe: null,
        }
      );
    }) as unknown as WorkerDeps['autoConfigure'],
    runRecipe: (async (input: {
      supplier: Supplier;
      recipe: SupplierRecipe;
      query: string;
    }): Promise<UniversalSearchResult> => {
      harness.recipeRunCalls.push({
        supplierId: input.supplier.id,
        query: input.query,
      });
      if (opts.recipeThrows?.[input.supplier.id]) {
        throw opts.recipeThrows[input.supplier.id];
      }
      const r = opts.recipeResults?.[input.supplier.id];
      if (r) return r;
      // default: not_found
      return {
        found: false,
        status: 'not_found',
        freight: null,
        freightStatus: 'not_available',
        productUrl: null,
        linkType: 'unknown',
        linkValidated: false,
      };
    }) as unknown as WorkerDeps['runRecipe'],
    insertResult: (async (
      searchId: string,
      sup: Supplier,
      payload: InsertResultPayload,
    ) => {
      harness.inserts.push({
        searchId,
        supplierId: sup.id,
        payload,
      });
    }) as WorkerDeps['insertResult'],
    markRunning: (async (searchId: string) => {
      harness.markRunningCalls.push(searchId);
    }) as WorkerDeps['markRunning'],
    finalizeStatus: (async (searchId: string) => {
      harness.finalizeCalls.push(searchId);
      return {
        status: 'completed' as const,
        best: { supplier: null, totalBrl: null },
      };
    }) as WorkerDeps['finalizeStatus'],
    convertToBrl: (async (amount: number, currency: string) => {
      if (currency === 'BRL') return { brl: amount, rate: 1 };
      const rate = opts.rate ?? 5;
      return { brl: parseFloat((amount * rate).toFixed(4)), rate };
    }) as WorkerDeps['convertToBrl'],
    cacheGet: (async <T,>(id: string, key: string): Promise<T | null> => {
      harness.cacheGetCalls.push({ supplierId: id, key });
      const v = cacheStore.get(`${id}::${key}`);
      return (v as T) ?? null;
    }) as WorkerDeps['cacheGet'],
    cacheSet: (async (id: string, key: string, value: unknown) => {
      harness.cacheSetCalls.push({ supplierId: id, key, value });
      cacheStore.set(`${id}::${key}`, value);
    }) as WorkerDeps['cacheSet'],
  };
  return { deps, harness };
}

// ─── 1, 7. Recipe certified → V2 validated → persistência completa ─────

describe('worker V2 — fornecedor certified', () => {
  it('chama runSupplierRecipe e persiste produto/preço/moeda/link/evidence (parcial: frete não confirmado)', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook dell',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });

    assert.equal(harness.recipeRunCalls.length, 1);
    assert.equal(harness.autoConfigCalls.length, 0);
    assert.equal(harness.inserts.length, 1);
    const p = harness.inserts[0]!.payload;
    // makeValidatedUniversal() tem freightStatus='not_available' → resultado PARCIAL
    assert.equal(p.status, 'partial');
    assert.equal(p.found, true);
    assert.equal(p.productName, 'Notebook Dell Inspiron 15 i5');
    assert.equal(p.price, 4599.9);
    assert.equal(p.currency, 'BRL');
    assert.equal(p.linkType, 'product');
    assert.equal(p.linkValidated, true);
    assert.ok(p.evidenceText);
    assert.equal(p.fromCache, false);
  });
});

// ─── 2, 3. Sem recipe → chama autoConfig uma vez ───────────────────────

describe('worker V2 — sem recipe', () => {
  it('chama autoConfigureSupplier UMA vez quando recipe é null', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'certified',
          platformDetected: 'shopify',
          searchUrlTemplate: 'https://loja.com/search?q={query}',
          confidence: 90,
          recipe: makeRecipe(),
        },
      },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });

    assert.equal(harness.autoConfigCalls.length, 1);
    assert.equal(harness.recipeRunCalls.length, 1);
    // default not_available → parcial
    assert.equal(harness.inserts[0]!.payload.status, 'partial');
  });

  it('autoConfig retorna certified → runSupplierRecipe roda em seguida', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: { ...makeRecipe(), status: 'unconfigured' } },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'certified',
          platformDetected: 'shopify',
          searchUrlTemplate: 'https://loja.com/search?q={query}',
          confidence: 90,
          recipe: makeRecipe(),
        },
      },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.recipeRunCalls.length, 1);
    // default not_available → parcial
    assert.equal(harness.inserts[0]!.payload.status, 'partial');
  });
});

// ─── 4, 5, 6. AutoConfig falha → resultado controlado ──────────────────

describe('worker V2 — autoConfig sem certificação', () => {
  it('needs_guided_setup → salva error com errorMessage="needs_supplier_setup: needs_guided_setup"', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'needs_guided_setup',
          platformDetected: 'custom',
          searchUrlTemplate: null,
          confidence: 40,
          recipe: null,
        },
      },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.recipeRunCalls.length, 0);
    assert.equal(harness.inserts[0]!.payload.status, 'error');
    assert.match(
      harness.inserts[0]!.payload.errorMessage ?? '',
      /needs_supplier_setup/,
    );
  });

  it('blocked → salva error controlado', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'blocked',
          confidence: 0,
          error: 'captcha cloudflare',
          recipe: null,
        },
      },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'error');
    assert.match(
      harness.inserts[0]!.payload.errorMessage ?? '',
      /needs_supplier_setup/,
    );
  });

  it('failed → salva error controlado e não chama runRecipe', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'failed',
          confidence: 0,
          recipe: null,
        },
      },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.recipeRunCalls.length, 0);
    assert.equal(harness.inserts[0]!.payload.status, 'error');
  });

  it('autoConfig lança exception → captura como error controlado', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoThrows: { [sup.id]: new Error('rede caiu') },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'error');
    assert.match(
      harness.inserts[0]!.payload.errorMessage ?? '',
      /autoConfig exception/,
    );
  });
});

// ─── 8. V2 com linkType=search NÃO salva como validated ────────────────

describe('worker V2 — validated falhando regras de validação', () => {
  it('linkType=search → invalid_link no payload (não é validated)', async () => {
    const sup = makeSupplier();
    const broken = makeValidatedUniversal({
      linkType: 'search',
      linkValidated: false,
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: broken },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.notEqual(harness.inserts[0]!.payload.status, 'validated');
    assert.equal(harness.inserts[0]!.payload.status, 'invalid_link');
    assert.equal(harness.inserts[0]!.payload.found, false);
  });

  it('sem evidence → invalid_link', async () => {
    const sup = makeSupplier();
    const broken = makeValidatedUniversal({ evidence: null });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: broken },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'invalid_link');
  });
});

// ─── 10–12. Status controlados ─────────────────────────────────────────

describe('worker V2 — status controlados', () => {
  it('price_not_found → salva status controlado sem inventar preço', async () => {
    const sup = makeSupplier();
    const r: UniversalSearchResult = {
      found: false,
      status: 'price_not_found',
      freight: null,
      freightStatus: 'not_available',
      productUrl: null,
      linkType: 'unknown',
      linkValidated: false,
    };
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'price_not_found');
    assert.equal(p.price, undefined);
    assert.equal(p.totalPrice, undefined);
  });

  it('product_mismatch → salva status controlado sem inventar produto', async () => {
    const sup = makeSupplier();
    const r: UniversalSearchResult = {
      found: false,
      status: 'product_mismatch',
      freight: null,
      freightStatus: 'not_available',
      productUrl: null,
      linkType: 'unknown',
      linkValidated: false,
    };
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'product_mismatch');
    assert.equal(p.productName, undefined);
  });

  it('not_found → salva status controlado', async () => {
    const sup = makeSupplier();
    const r: UniversalSearchResult = {
      found: false,
      status: 'not_found',
      freight: null,
      freightStatus: 'not_available',
      productUrl: null,
      linkType: 'unknown',
      linkValidated: false,
    };
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'not_found');
  });
});

// ─── 13, 17. Falha isolada — outros fornecedores continuam ────────────

describe('worker V2 — isolamento de falhas', () => {
  it('V2 blocked em um supplier não quebra os outros', async () => {
    const supA = makeSupplier({ id: 'sA', name: 'A', site: 'a.com' });
    const supB = makeSupplier({ id: 'sB', name: 'B', site: 'b.com' });
    const { deps, harness } = makeDeps({
      recipes: { [supA.id]: makeRecipe(), [supB.id]: makeRecipe() },
      recipeResults: {
        [supA.id]: {
          found: false,
          status: 'blocked',
          freight: null,
          freightStatus: 'not_available',
          productUrl: null,
          linkType: 'unknown',
          linkValidated: false,
        },
        [supB.id]: makeValidatedUniversal({
          productUrl: 'https://b.com/products/x',
          freight: 0,
          freightStatus: 'free_confirmed',
          totalPrice: 4599.9,
          evidence: {
            sourceUrl: 'https://b.com/products/x',
            evidenceText: 'JSON-LD Product · price=4599.9 BRL',
            extractedAt: '2026-05-22T12:00:00.000Z',
            strategy: 'json_ld',
          },
        }),
      },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [supA, supB],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts.length, 2);
    const a = harness.inserts.find((i) => i.supplierId === 'sA')!.payload;
    const b = harness.inserts.find((i) => i.supplierId === 'sB')!.payload;
    assert.equal(a.status, 'blocked');
    assert.equal(b.status, 'validated');
  });

  it('runRecipe lança exception → resultado error controlado, finalizeStatus ainda roda', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeThrows: { [sup.id]: new Error('runner crashou') },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'error');
    assert.equal(harness.finalizeCalls.length, 1);
  });
});

// ─── 14. V2 timeout/error não quebra busca ─────────────────────────────

describe('worker V2 — timeout/error', () => {
  it('V2 retorna status=timeout → salva como timeout sem derrubar busca', async () => {
    const sup = makeSupplier();
    const r: UniversalSearchResult = {
      found: false,
      status: 'timeout',
      freight: null,
      freightStatus: 'not_available',
      productUrl: null,
      linkType: 'unknown',
      linkValidated: false,
    };
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.inserts[0]!.payload.status, 'timeout');
    assert.equal(harness.finalizeCalls.length, 1);
  });
});

// ─── 15, 16. Frete ─────────────────────────────────────────────────────

describe('worker V2 — frete', () => {
  it('freightStatus=not_available → status=partial, freight/totalPrice/totalBrl undefined, priceBrl presente', async () => {
    const sup = makeSupplier();
    const r = makeValidatedUniversal({
      freight: null,
      freightStatus: 'not_available',
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'partial');
    assert.equal(p.freight, undefined);
    assert.equal(p.totalPrice, undefined);
    assert.equal(p.totalBrl, undefined);
    // preço convertido (sem frete) continua disponível
    assert.equal(p.priceBrl, 4599.9);
    assert.match(p.warning ?? '', /a confirmar/i);
  });

  it('freightStatus=free_confirmed → freight=0, totalPrice=price', async () => {
    const sup = makeSupplier();
    const r = makeValidatedUniversal({
      freight: 0,
      freightStatus: 'free_confirmed',
      totalPrice: 4599.9,
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'validated');
    assert.equal(p.freight, 0);
    assert.equal(p.totalPrice, 4599.9);
    // BRL → rate=1, totalBrl=4599.9
    assert.equal(p.totalBrl, 4599.9);
    assert.equal(p.priceBrl, 4599.9);
  });

  it('freightStatus=confirmed com freight>0 → totalPrice=price+freight', async () => {
    const sup = makeSupplier();
    const r = makeValidatedUniversal({
      freight: 29.9,
      freightStatus: 'confirmed',
      totalPrice: 4629.8,
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'validated');
    assert.equal(p.freight, 29.9);
    assert.ok(Math.abs((p.totalPrice ?? 0) - 4629.8) < 0.01);
  });

  it('freightStatus=estimated → não confirma total final', async () => {
    const sup = makeSupplier();
    const r = makeValidatedUniversal({
      freight: 15,
      freightStatus: 'estimated',
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.status, 'partial');
    assert.equal(p.totalPrice, undefined);
    assert.equal(p.totalBrl, undefined);
    assert.match(p.warning ?? '', /estimad/i);
  });
});

// ─── 18. Cotação ───────────────────────────────────────────────────────

describe('worker V2 — cotação', () => {
  it('aplica convertToBrl injetado para moeda diferente de BRL', async () => {
    const sup = makeSupplier({ currency: 'USD' });
    const r = makeValidatedUniversal({
      currency: 'USD',
      price: 100,
      freight: 0,
      freightStatus: 'free_confirmed',
      totalPrice: 100,
    });
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
      rate: 5,
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    const p = harness.inserts[0]!.payload;
    assert.equal(p.currency, 'USD');
    assert.equal(p.price, 100);
    assert.equal(p.exchangeRateUsed, 5);
    assert.equal(p.totalBrl, 500);
  });
});

// ─── 21. AutoConfig não roda em loop ───────────────────────────────────

describe('worker V2 — autoConfig uma vez por busca', () => {
  it('autoConfig é chamado no MÁXIMO uma vez por supplier na mesma busca', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: null },
      autoResults: {
        [sup.id]: {
          supplierId: sup.id,
          status: 'needs_guided_setup',
          confidence: 30,
          recipe: null,
        },
      },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.autoConfigCalls.length, 1);
  });
});

// ─── 22. Cache: gate de qualidade ─────────────────────────────────────

describe('worker V2 — cache', () => {
  it('cache hit válido (isCacheValid=true) → fromCache=true, status=cached, não chama recipe', async () => {
    const sup = makeSupplier();
    const cachedKey = `${sup.id}::${'notebook dell'.toLowerCase()}`;
    const cacheBlob = {
      status: 'validated' as const,
      productName: 'Notebook Dell',
      price: 3000,
      currency: 'BRL',
      productUrl: 'https://loja.com/p/x',
      linkType: 'product' as const,
      linkValidated: true,
      evidenceText: 'JSON-LD Product · price=3000 BRL',
      sourceUrl: 'https://loja.com/p/x',
      sourceName: 'v2_recipe_runner',
      // resultado completo (frete grátis confirmado) → reusado como 'cached'
      freightStatus: 'free_confirmed' as const,
      freight: 0,
      cachedAt: '2026-05-22T11:00:00.000Z',
    };
    const { deps, harness } = makeDeps({
      cache: { [cachedKey]: cacheBlob },
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook dell',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.recipeRunCalls.length, 0);
    assert.equal(harness.cacheGetCalls.length, 1);
    const p = harness.inserts[0]!.payload;
    assert.equal(p.fromCache, true);
    assert.equal(p.status, 'cached');
  });

  it('cache hit INVÁLIDO (sem evidence) → ignora cache e roda V2 normalmente', async () => {
    const sup = makeSupplier();
    const cachedKey = `${sup.id}::${'notebook'.toLowerCase()}`;
    const cacheBlob = {
      status: 'validated' as const,
      productName: 'X',
      price: 3000,
      currency: 'BRL',
      productUrl: 'https://x.com/p',
      linkType: 'product' as const,
      linkValidated: true,
      // evidenceText AUSENTE → cache inválido
      cachedAt: '2026-05-22T11:00:00.000Z',
    };
    const { deps, harness } = makeDeps({
      cache: { [cachedKey]: cacheBlob },
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.recipeRunCalls.length, 1);
    assert.equal(harness.inserts[0]!.payload.fromCache, false);
  });

  it('V2 validated → grava no cache', async () => {
    const sup = makeSupplier();
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'notebook dell',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.cacheSetCalls.length, 1);
  });

  it('V2 não-validated → NÃO grava no cache', async () => {
    const sup = makeSupplier();
    const r: UniversalSearchResult = {
      found: false,
      status: 'not_found',
      freight: null,
      freightStatus: 'not_available',
      productUrl: null,
      linkType: 'unknown',
      linkValidated: false,
    };
    const { deps, harness } = makeDeps({
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: r },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: false,
      deps,
    });
    assert.equal(harness.cacheSetCalls.length, 0);
  });

  it('forceRefresh=true ignora cache', async () => {
    const sup = makeSupplier();
    const cachedKey = `${sup.id}::${'x'.toLowerCase()}`;
    const cacheBlob = {
      status: 'validated' as const,
      productName: 'X',
      price: 100,
      currency: 'BRL',
      productUrl: 'https://x.com/p',
      linkType: 'product' as const,
      linkValidated: true,
      evidenceText: 'evidence',
      sourceUrl: 'https://x.com/p',
      sourceName: 'v2',
      cachedAt: '2026-05-22T11:00:00.000Z',
    };
    const { deps, harness } = makeDeps({
      cache: { [cachedKey]: cacheBlob },
      recipes: { [sup.id]: makeRecipe() },
      recipeResults: { [sup.id]: makeValidatedUniversal() },
    });
    await runSearchWorker({
      searchId: 's1',
      query: 'x',
      suppliers: [sup],
      forceRefresh: true,
      deps,
    });
    assert.equal(harness.cacheGetCalls.length, 0);
    assert.equal(harness.recipeRunCalls.length, 1);
  });
});

// ─── isCacheValid unitário ────────────────────────────────────────────

describe('isCacheValid (exportado pelo worker)', () => {
  it('aceita cache completo', () => {
    assert.equal(
      isCacheValid({
        status: 'validated',
        productName: 'X',
        price: 100,
        currency: 'BRL',
        productUrl: 'https://x.com/p',
        linkType: 'product',
        linkValidated: true,
        evidenceText: 'ev',
        cachedAt: 'now',
      }),
      true,
    );
  });
  it('rejeita sem evidence', () => {
    assert.equal(
      isCacheValid({
        status: 'validated',
        productName: 'X',
        price: 100,
        currency: 'BRL',
        productUrl: 'https://x.com/p',
        linkType: 'product',
        linkValidated: true,
        cachedAt: 'now',
      }),
      false,
    );
  });
  it('rejeita linkType=search', () => {
    assert.equal(
      isCacheValid({
        status: 'validated',
        productName: 'X',
        price: 100,
        currency: 'BRL',
        productUrl: 'https://x.com/p',
        linkType: 'search',
        linkValidated: true,
        evidenceText: 'ev',
        cachedAt: 'now',
      }),
      false,
    );
  });
  it('rejeita null', () => {
    assert.equal(isCacheValid(null), false);
  });
});

// ─── mapV2StatusToLegacy ───────────────────────────────────────────────

describe('mapV2StatusToLegacy', () => {
  it('validated → validated', () => {
    assert.equal(mapV2StatusToLegacy('validated').status, 'validated');
  });
  it('blocked → blocked', () => {
    assert.equal(mapV2StatusToLegacy('blocked').status, 'blocked');
  });
  it('needs_supplier_setup → error com errorMessage indicando setup', () => {
    const r = mapV2StatusToLegacy('needs_supplier_setup');
    assert.equal(r.status, 'error');
    assert.match(r.errorMessage ?? '', /needs_supplier_setup/);
  });
});

// ─── 19, 20. Escopo V2 ─────────────────────────────────────────────────

describe('escopo V2', () => {
  it('mapUniversalResultToInsertPayload — validated com frete confirmado produz payload completo', async () => {
    const u = makeValidatedUniversal({
      freight: 0,
      freightStatus: 'free_confirmed',
      totalPrice: 4599.9,
    });
    const p = await mapUniversalResultToInsertPayload({
      result: u,
      convertToBrl: async (amt, cur) => ({
        brl: cur === 'BRL' ? amt : amt * 5,
        rate: cur === 'BRL' ? 1 : 5,
      }),
      sourceName: 'v2_recipe_runner',
    });
    assert.equal(p.status, 'validated');
    assert.equal(p.productName, 'Notebook Dell Inspiron 15 i5');
    assert.equal(p.sourceName, 'v2_recipe_runner');
    assert.equal(p.totalBrl, 4599.9);
    assert.equal(p.priceBrl, 4599.9);
  });

  it('mapUniversalResultToInsertPayload — V2 validated mas helper falha → invalid_link', async () => {
    const u = makeValidatedUniversal({
      linkType: 'search',
      linkValidated: false,
    });
    const p = await mapUniversalResultToInsertPayload({
      result: u,
      convertToBrl: async () => ({ brl: 0, rate: 0 }),
    });
    assert.equal(p.status, 'invalid_link');
  });
});

/**
 * Testes de integração do Firecrawl no V2.
 *
 * Cobertura:
 *  1. createFirecrawlFetcher — Firecrawl retorna produto com preço (HTML válido)
 *  2. createFirecrawlFetcher — Firecrawl retorna página sem preço (ok, extrator decide)
 *  3. createFirecrawlFetcher — Firecrawl rate_limited (429) → blocked
 *  4. createFirecrawlFetcher — falha de rede → status 'error' controlado
 *  5. createFirecrawlFetcher — AbortError/timeout → status 'error' com 'timeout'
 *  6. createFetcherForConfig — apiKey vazia → direct_fetch sem Firecrawl
 *  7. createFetcherForConfig — mode 'preferred': API falha → fallback direct_fetch
 *  8. createFetcherForConfig — mode 'fallback': direct_fetch blocked → Firecrawl
 *  9. worker — recipe runner retorna blocked → status='blocked' (não 'erro inesperado')
 * 10. worker — Amazon BR sem certificação → needs_supplier_setup
 * 11. firecrawlClient — HTTP 401 → auth_error
 * 12. firecrawlClient — success=false → status 'error' com mensagem
 * 13. isCacheValid — resultado blocked nunca passa; evidenceText vazio bloqueia
 *
 * Nenhum teste depende de internet, DB real ou Firecrawl real.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { createFirecrawlFetcher, createFetcherForConfig } = await import(
  '../suppliers/v2/fetching/firecrawlFetcher.js'
);
const { createFirecrawlClient } = await import(
  '../suppliers/v2/fetching/firecrawlClient.js'
);
const { runSearchWorker, isCacheValid } = await import(
  '../workers/priceSearchWorker.js'
);
const { buildStatusResult } = await import(
  '../suppliers/v2/recipeRunner/index.js'
);
const { cacheService } = await import('../services/cacheService.js');
const { closePool } = await import('../db/client.js');

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

// ─── Helpers ────────────────────────────────────────────────────────────

type MockFetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;
let savedFetch: typeof globalThis.fetch;

function mockFetch(impl: MockFetchFn): void {
  savedFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>)['fetch'] = impl;
}

function restoreFetch(): void {
  (globalThis as Record<string, unknown>)['fetch'] = savedFetch;
}

function firecrawlOkResponse(html: string, destUrl = 'https://example.com/p/1'): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: { html, metadata: { statusCode: 200, url: destUrl } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const PRODUCT_HTML = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Notebook Dell Inspiron 15",
 "offers":{"@type":"Offer","price":"4599.90","priceCurrency":"BRL"}}
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1><p>R$ 4.599,90</p></body></html>`;

const NO_PRICE_HTML = `<html><body><h1>Notebook Dell</h1><p>Consulte disponibilidade.</p></body></html>`;

type Supplier = import('../services/supplierService.js').Supplier;
type SupplierRecipe = import('../suppliers/v2/index.js').SupplierRecipe;
type WorkerDeps = import('../workers/priceSearchWorker.js').WorkerDeps;

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-amazon',
    name: 'Amazon BR',
    site: 'amazon.com.br',
    search_url_template: 'https://www.amazon.com.br/s?k={query}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    certificationStatus: 'unconfigured',
    setupStatus: 'unconfigured',
    autoConfiguredAt: null,
    recipe: null,
    ...over,
  };
}

function makeCertifiedRecipe(over: Partial<SupplierRecipe> = {}): SupplierRecipe {
  return {
    supplierId: 'sup-amazon',
    status: 'certified',
    platformDetected: 'custom',
    searchUrlTemplate: 'https://www.amazon.com.br/s?k={query}',
    productUrlPatterns: ['/dp/'],
    extractionStrategy: 'json_ld',
    jsonLdEnabled: true,
    requiresJs: false,
    requiresBrowser: false,
    confidence: 85,
    ...over,
  };
}

function makeDeps(partial: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    getRecipe: async () => null,
    autoConfigure: async () => ({
      supplierId: 'sup-amazon',
      status: 'failed',
      platformDetected: null,
      searchUrlTemplate: null,
      confidence: 0,
      error: 'falha simulada',
      recipe: null,
    }),
    insertResult: async () => {},
    markRunning: async () => {},
    finalizeStatus: async () => ({ status: 'completed' as const, best: { supplier: null, totalBrl: null } }),
    convertToBrl: async (_amount, _currency) => ({ brl: _amount, rate: 1 }),
    cacheGet: async () => null,
    cacheSet: async () => {},
    // Foca no fluxo de recipe/Firecrawl; catalog-first tem testes próprios.
    catalogSearchEnabled: false,
    ...partial,
  };
}

// ─── 1–5. createFirecrawlFetcher ─────────────────────────────────────────

describe('createFirecrawlFetcher — respostas Firecrawl', () => {
  afterEach(() => restoreFetch());

  it('1. HTML de produto válido → status ok com html', async () => {
    mockFetch(async () => firecrawlOkResponse(PRODUCT_HTML));
    const fetcher = createFirecrawlFetcher('fc-test-key');
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test');
    assert.equal(res.status, 'ok');
    assert.ok(res.html?.includes('Notebook Dell'), 'html deve conter o produto');
  });

  it('2. HTML sem preço → status ok (extração de preço é responsabilidade do runner)', async () => {
    mockFetch(async () => firecrawlOkResponse(NO_PRICE_HTML));
    const fetcher = createFirecrawlFetcher('fc-test-key');
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test');
    assert.equal(res.status, 'ok');
    assert.ok(res.html?.includes('Notebook Dell'));
  });

  it('3. API Firecrawl HTTP 429 (rate_limited) → status blocked', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ success: false, error: 'Rate limit' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const fetcher = createFirecrawlFetcher('fc-test-key');
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test');
    assert.equal(res.status, 'blocked');
    assert.equal(res.httpStatus, 429);
  });

  it('4. falha de rede (throw) → status error controlado, não lança', async () => {
    mockFetch(async () => { throw new Error('ECONNREFUSED'); });
    const fetcher = createFirecrawlFetcher('fc-test-key');
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test');
    assert.equal(res.status, 'error');
    assert.ok(res.error, 'deve ter mensagem de erro');
    assert.doesNotThrow(() => res);
  });

  it('5. AbortError (timeout) → status error com "timeout" na mensagem', async () => {
    mockFetch(async () => {
      const e = new DOMException('The operation was aborted', 'AbortError');
      throw e;
    });
    const fetcher = createFirecrawlFetcher('fc-test-key');
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test', { timeoutMs: 1 });
    assert.equal(res.status, 'error');
    assert.ok(res.error && /timeout/i.test(res.error), `mensagem deve conter 'timeout', recebeu: ${res.error}`);
  });
});

// ─── 11–12. firecrawlClient — erros HTTP da API ──────────────────────────

describe('createFirecrawlClient — erros HTTP', () => {
  afterEach(() => restoreFetch());

  it('11. HTTP 401 → status auth_error', async () => {
    mockFetch(async () => new Response('Unauthorized', { status: 401 }));
    const client = createFirecrawlClient('invalid-key');
    const res = await client.scrape({ url: 'https://example.com' });
    assert.equal(res.status, 'auth_error');
  });

  it('12. success=false na resposta JSON → status error com mensagem', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ success: false, error: 'URL inválida' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createFirecrawlClient('fc-test-key');
    const res = await client.scrape({ url: 'https://example.com' });
    assert.equal(res.status, 'error');
    assert.ok(res.error?.includes('URL inválida'));
  });
});

// ─── 6–8. createFetcherForConfig — seleção de provider ──────────────────

describe('createFetcherForConfig — seleção de provider', () => {
  afterEach(() => restoreFetch());

  it('6. apiKey vazia → direct_fetch (Firecrawl nunca chamado)', async () => {
    let firecrawlCalled = false;
    mockFetch(async (url: string | URL) => {
      if (String(url).includes('firecrawl')) firecrawlCalled = true;
      return new Response('<html><body>ok</body></html>', { status: 200 });
    });
    const fetcher = createFetcherForConfig({ firecrawlApiKey: '', firecrawlMode: 'preferred' });
    const res = await fetcher.fetchText('https://example.com');
    assert.equal(res.status, 'ok');
    assert.equal(firecrawlCalled, false, 'Firecrawl não deve ser chamado sem apiKey');
  });

  it("7. preferred: Firecrawl auth_error → fallback para direct_fetch", async () => {
    let callCount = 0;
    mockFetch(async (url: string | URL) => {
      callCount++;
      if (String(url).includes('firecrawl')) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response('<html><body><h1>Produto ok</h1></body></html>', { status: 200 });
    });
    const fetcher = createFetcherForConfig({ firecrawlApiKey: 'fc-invalid', firecrawlMode: 'preferred' });
    const res = await fetcher.fetchText('https://example.com');
    assert.equal(res.status, 'ok');
    assert.equal(callCount, 2, 'deve ter chamado Firecrawl e depois direct_fetch');
  });

  it("8. fallback: direct_fetch 403 blocked → tenta Firecrawl", async () => {
    let firecrawlCalled = false;
    mockFetch(async (url: string | URL) => {
      if (String(url).includes('firecrawl')) {
        firecrawlCalled = true;
        return firecrawlOkResponse(PRODUCT_HTML);
      }
      return new Response('Forbidden', { status: 403 });
    });
    const fetcher = createFetcherForConfig({ firecrawlApiKey: 'fc-valid', firecrawlMode: 'fallback' });
    const res = await fetcher.fetchText('https://www.amazon.com.br/p/test');
    assert.equal(res.status, 'ok');
    assert.equal(firecrawlCalled, true, 'Firecrawl deve ter sido chamado como fallback');
  });
});

// ─── 9–10. Worker — status controlados, nunca 'erro inesperado' ──────────

describe('worker — Firecrawl e Amazon BR: status sempre controlados', () => {
  it('9. recipe runner retorna blocked → worker grava status=blocked sem "erro inesperado"', async () => {
    const inserted: Array<{ status: string; errorMessage?: string }> = [];
    const deps = makeDeps({
      getRecipe: async () => makeCertifiedRecipe(),
      runRecipe: async () => buildStatusResult('blocked', 'Firecrawl: rate limit atingido'),
      insertResult: async (_sid, _sup, payload) => {
        inserted.push({ status: payload.status, errorMessage: payload.errorMessage });
      },
    });

    await runSearchWorker({
      searchId: 'search-009',
      query: 'notebook',
      suppliers: [makeSupplier({ certificationStatus: 'certified' })],
      forceRefresh: false,
      deps,
    });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.status, 'blocked');
    assert.ok(
      !inserted[0]!.errorMessage?.toLowerCase().includes('erro inesperado'),
      'mensagem não deve conter "erro inesperado"',
    );
  });

  it('10. Amazon BR sem certificação → needs_supplier_setup, não "erro inesperado"', async () => {
    const inserted: Array<{ status: string; errorMessage?: string }> = [];
    const deps = makeDeps({
      getRecipe: async () => null,
      autoConfigure: async () => ({
        supplierId: 'sup-amazon',
        status: 'blocked' as const,
        platformDetected: null,
        searchUrlTemplate: null,
        confidence: 0,
        error: 'Amazon bloqueou acesso ao autoConfig',
        recipe: null,
      }),
      insertResult: async (_sid, _sup, payload) => {
        inserted.push({ status: payload.status, errorMessage: payload.errorMessage });
      },
    });

    await runSearchWorker({
      searchId: 'search-010',
      query: 'iphone',
      suppliers: [makeSupplier({ certificationStatus: 'unconfigured' })],
      forceRefresh: false,
      deps,
    });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.status, 'error');
    assert.ok(
      inserted[0]!.errorMessage?.includes('needs_supplier_setup'),
      'deve conter needs_supplier_setup',
    );
    assert.ok(
      !inserted[0]!.errorMessage?.toLowerCase().includes('erro inesperado'),
      'não deve conter "erro inesperado"',
    );
  });
});

// ─── 13. isCacheValid — sanidade ─────────────────────────────────────────

describe('isCacheValid — resultado Firecrawl só entra no cache se completo', () => {
  it('13a. resultado blocked nunca passa isCacheValid', () => {
    assert.equal(
      isCacheValid({ status: 'blocked' as never, cachedAt: new Date().toISOString() }),
      false,
    );
  });

  it('13b. validated sem evidenceText não entra no cache', () => {
    assert.equal(
      isCacheValid({
        status: 'validated',
        price: 4599,
        productName: 'Notebook',
        currency: 'BRL',
        productUrl: 'https://amazon.com.br/dp/X',
        linkType: 'product',
        linkValidated: true,
        evidenceText: '',
        cachedAt: new Date().toISOString(),
      }),
      false,
    );
  });

  it('13c. validated completo com evidenceText passa isCacheValid', () => {
    assert.equal(
      isCacheValid({
        status: 'validated',
        price: 4599,
        productName: 'Notebook Dell',
        currency: 'BRL',
        productUrl: 'https://amazon.com.br/dp/B09XYZ',
        linkType: 'product',
        linkValidated: true,
        evidenceText: 'JSON-LD price=4599 BRL',
        cachedAt: new Date().toISOString(),
      }),
      true,
    );
  });
});

/**
 * Etapa 15 — Catalog Discovery (Firecrawl Search/Map, Sitemap, Search Page).
 *
 * Nenhuma chamada de rede real: Firecrawl clients, sitemap fetch e o
 * FetchProvider de busca são mockados. O catalogService é um fake que registra
 * upserts/runs.
 *
 * Cobre:
 *  - Firecrawl Search transforma resultados em candidates (+ qualificador site:)
 *  - Firecrawl Map transforma URLs em candidates (links string e objeto)
 *  - Sitemap parseia <loc> e filtra produtos
 *  - candidatos duplicados não duplicam (mapper)
 *  - source correta é salva
 *  - discovery_run criado e finalizado
 *  - no_candidates quando nada útil aparece
 *  - blocked/rate_limited viram status controlado
 *  - chave do Firecrawl só vai no header Authorization (nunca no resultado)
 *  - orquestrador não chama IA/Gemini (sem deps de IA, sem vazamento de chave)
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const {
  parseSitemapLocs,
  parseRobotsSitemaps,
  discoverViaSitemap,
} = await import('../suppliers/v2/searchEngine/catalogDiscovery/sitemapDiscovery.js');
const {
  createFirecrawlSearchClient,
  discoverViaFirecrawlSearch,
  parseFirecrawlSearchItems,
} = await import(
  '../suppliers/v2/searchEngine/catalogDiscovery/firecrawlSearchDiscovery.js'
);
const {
  createFirecrawlMapClient,
  discoverViaFirecrawlMap,
  parseFirecrawlMapItems,
} = await import('../suppliers/v2/searchEngine/catalogDiscovery/firecrawlMapDiscovery.js');
const { mapDiscoveredUrlsToCandidates } = await import(
  '../suppliers/v2/searchEngine/catalogDiscovery/catalogDiscoveryMapper.js'
);
const { runCatalogDiscovery } = await import(
  '../suppliers/v2/searchEngine/catalogDiscovery/catalogDiscoveryOrchestrator.js'
);
const { closePool } = await import('../db/client.js');

import type { Supplier } from '../services/supplierService.js';
import type { SupplierProductCatalogService } from '../suppliers/v2/catalog/index.js';
import type {
  FirecrawlSearchClient,
  FirecrawlSearchOutcome,
} from '../suppliers/v2/searchEngine/catalogDiscovery/firecrawlSearchDiscovery.js';
import type {
  FirecrawlMapClient,
  FirecrawlMapOutcome,
} from '../suppliers/v2/searchEngine/catalogDiscovery/firecrawlMapDiscovery.js';
import type { FetchProvider } from '../suppliers/v2/searchEngine/index.js';

after(async () => {
  await closePool().catch(() => {});
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    name: 'Kabum',
    site: 'www.kabum.com.br',
    search_url_template: 'https://www.kabum.com.br/busca?query={q}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    certificationStatus: 'unconfigured',
    setupStatus: 'unconfigured',
    autoConfiguredAt: null,
    recipe: null,
    ...overrides,
  };
}

interface CatalogCalls {
  upserts: Array<{ source: string; productUrl: string; urlHash: string; status?: string }>;
  createdRuns: Array<{ source: string }>;
  finishedRuns: Array<{ runId: string; status: string; found: number; saved: number }>;
  reusableQueried: number;
}

function makeFakeCatalog(reusableCount = 0): {
  service: SupplierProductCatalogService;
  calls: CatalogCalls;
} {
  const calls: CatalogCalls = {
    upserts: [],
    createdRuns: [],
    finishedRuns: [],
    reusableQueried: 0,
  };
  let runSeq = 0;

  const service: SupplierProductCatalogService = {
    async upsertCandidate(input) {
      calls.upserts.push({
        source: input.source,
        productUrl: input.productUrl,
        urlHash: input.urlHash,
        status: input.status,
      });
      return { id: `cand-${calls.upserts.length}` } as never;
    },
    async listCandidatesByQuery() {
      return [];
    },
    async listReusableMatches() {
      calls.reusableQueried += 1;
      return Array.from({ length: reusableCount }, (_, i) => ({ id: `m-${i}` })) as never;
    },
    async updateCandidateExtraction() {
      return {} as never;
    },
    async createDiscoveryRun(input) {
      runSeq += 1;
      calls.createdRuns.push({ source: input.source });
      return { id: `run-${runSeq}`, source: input.source } as never;
    },
    async finishDiscoveryRun(input) {
      calls.finishedRuns.push({
        runId: input.runId,
        status: input.status,
        found: input.candidatesFound,
        saved: input.candidatesSaved,
      });
      return {} as never;
    },
    async createOrUpdateMatch() {
      return {} as never;
    },
  };

  return { service, calls };
}

function fakeSearchClient(outcome: FirecrawlSearchOutcome): {
  client: FirecrawlSearchClient;
  queries: string[];
} {
  const queries: string[] = [];
  const client: FirecrawlSearchClient = {
    async search(query) {
      queries.push(query);
      return outcome;
    },
  };
  return { client, queries };
}

function fakeMapClient(outcome: FirecrawlMapOutcome): {
  client: FirecrawlMapClient;
  calls: Array<{ url: string; search?: string }>;
} {
  const callsArr: Array<{ url: string; search?: string }> = [];
  const client: FirecrawlMapClient = {
    async map(url, opts) {
      callsArr.push({ url, search: opts?.search });
      return outcome;
    },
  };
  return { client, calls: callsArr };
}

// ─── Firecrawl Search ──────────────────────────────────────────────────────

describe('discoverViaFirecrawlSearch', () => {
  it('transforma resultados em URLs e usa qualificador site:', async () => {
    const { client, queries } = fakeSearchClient({
      status: 'success',
      elapsedMs: 10,
      items: [
        { url: 'https://www.kabum.com.br/produto/111/ssd-1tb', title: 'SSD 1TB' },
        { url: 'https://www.kabum.com.br/produto/222/ssd-2tb' },
      ],
    });
    const sd = await discoverViaFirecrawlSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      client,
    );
    assert.equal(sd.fetchStatus, 'success');
    assert.equal(sd.urls.length, 2);
    assert.equal(queries[0], 'ssd 1tb nvme site:kabum.com.br');
  });

  it('blocked → fetchStatus blocked, sem URLs', async () => {
    const { client } = fakeSearchClient({
      status: 'blocked',
      elapsedMs: 5,
      items: [],
      errorMessage: 'destino bloqueou',
    });
    const sd = await discoverViaFirecrawlSearch(
      { supplier: makeSupplier(), query: 'ssd' },
      client,
    );
    assert.equal(sd.fetchStatus, 'blocked');
    assert.equal(sd.urls.length, 0);
  });

  it('parseFirecrawlSearchItems lê data.web e ignora não-URLs', () => {
    const items = parseFirecrawlSearchItems({
      success: true,
      data: { web: [{ url: 'https://x.com/p' }, { url: 'not-a-url' }, { title: 'sem url' }] },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.url, 'https://x.com/p');
  });

  it('chave vai só no header Authorization, nunca no resultado', async () => {
    let capturedAuth: string | undefined;
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.['Authorization'];
      return new Response(JSON.stringify({ success: true, data: { web: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createFirecrawlSearchClient({
      apiKey: 'fc-secret-key-xyz',
      fetchFn: fakeFetch as typeof fetch,
    });
    const outcome = await client.search('ssd site:kabum.com.br');
    assert.equal(capturedAuth, 'Bearer fc-secret-key-xyz');
    assert.ok(!JSON.stringify(outcome).includes('fc-secret-key-xyz'));
  });

  it('mapeia 429 → rate_limited e 402 → no_credits sem vazar chave', async () => {
    for (const [httpStatus, expected] of [
      [429, 'rate_limited'],
      [402, 'no_credits'],
    ] as const) {
      const fakeFetch = async () =>
        new Response('{}', { status: httpStatus });
      const client = createFirecrawlSearchClient({
        apiKey: 'fc-secret',
        fetchFn: fakeFetch as typeof fetch,
      });
      const outcome = await client.search('q');
      assert.equal(outcome.status, expected);
      assert.ok(!JSON.stringify(outcome).includes('fc-secret'));
    }
  });
});

// ─── Firecrawl Map ─────────────────────────────────────────────────────────

describe('discoverViaFirecrawlMap', () => {
  it('transforma links (objetos) em URLs e passa search', async () => {
    const { client, calls } = fakeMapClient({
      status: 'success',
      elapsedMs: 10,
      items: [
        { url: 'https://www.kabum.com.br/produto/111/ssd' },
        { url: 'https://www.kabum.com.br/produto/222/hd' },
      ],
    });
    const sd = await discoverViaFirecrawlMap(
      { supplier: makeSupplier(), query: 'ssd 1tb' },
      client,
    );
    assert.equal(sd.fetchStatus, 'success');
    assert.equal(sd.urls.length, 2);
    assert.equal(calls[0]!.url, 'https://kabum.com.br');
    assert.equal(calls[0]!.search, 'ssd 1tb');
  });

  it('parseFirecrawlMapItems aceita links como strings ou objetos', () => {
    const fromStrings = parseFirecrawlMapItems({
      links: ['https://x.com/a', 'https://x.com/b', 'bad'],
    });
    assert.equal(fromStrings.length, 2);
    const fromObjects = parseFirecrawlMapItems({
      links: [{ url: 'https://x.com/a', title: 'A' }],
    });
    assert.equal(fromObjects.length, 1);
    assert.equal(fromObjects[0]!.title, 'A');
  });
});

// ─── Sitemap ───────────────────────────────────────────────────────────────

describe('sitemap parsing', () => {
  it('parseSitemapLocs extrai <loc>', () => {
    const xml = `<urlset><url><loc>https://x.com/produto/1</loc></url><url><loc>https://x.com/produto/2</loc></url></urlset>`;
    const locs = parseSitemapLocs(xml);
    assert.deepEqual(locs, ['https://x.com/produto/1', 'https://x.com/produto/2']);
  });

  it('parseRobotsSitemaps extrai linhas Sitemap:', () => {
    const robots = 'User-agent: *\nDisallow:\nSitemap: https://x.com/sitemap.xml\n';
    assert.deepEqual(parseRobotsSitemaps(robots), ['https://x.com/sitemap.xml']);
  });
});

describe('discoverViaSitemap', () => {
  it('parseia URLs e filtra para produtos do mesmo domínio', async () => {
    const sitemapXml = `<urlset>
      <url><loc>https://www.kabum.com.br/produto/111/ssd-1tb</loc></url>
      <url><loc>https://www.kabum.com.br/produto/222/ssd-2tb</loc></url>
      <url><loc>https://www.kabum.com.br/categoria/ssd</loc></url>
    </urlset>`;
    const fakeFetch = async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/sitemap.xml')) {
        return new Response(sitemapXml, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const sd = await discoverViaSitemap({
      supplier: makeSupplier(),
      query: 'ssd 1tb',
      fetchFn: fakeFetch as typeof fetch,
    });
    assert.equal(sd.fetchStatus, 'success');
    // a categoria deve ser filtrada — só os 2 /produto/ passam
    assert.equal(sd.urls.length, 2);
    assert.ok(sd.urls.every((u) => u.url.includes('/produto/')));
  });

  it('segue sitemap index para sub-sitemaps', async () => {
    const indexXml = `<sitemapindex><sitemap><loc>https://www.kabum.com.br/sitemap-produtos.xml</loc></sitemap></sitemapindex>`;
    const childXml = `<urlset><url><loc>https://www.kabum.com.br/produto/999/x</loc></url></urlset>`;
    const fakeFetch = async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/sitemap.xml')) return new Response(indexXml, { status: 200 });
      if (u.endsWith('/sitemap-produtos.xml')) return new Response(childXml, { status: 200 });
      return new Response('404', { status: 404 });
    };
    const sd = await discoverViaSitemap({
      supplier: makeSupplier(),
      query: 'x',
      fetchFn: fakeFetch as typeof fetch,
    });
    assert.equal(sd.fetchStatus, 'success');
    assert.equal(sd.urls.length, 1);
    assert.equal(sd.urls[0]!.url, 'https://www.kabum.com.br/produto/999/x');
  });

  it('tudo 404 → erro controlado, não lança', async () => {
    const fakeFetch = async () => new Response('nope', { status: 404 });
    const sd = await discoverViaSitemap({
      supplier: makeSupplier(),
      query: 'x',
      fetchFn: fakeFetch as typeof fetch,
    });
    assert.equal(sd.fetchStatus, 'error');
    assert.equal(sd.urls.length, 0);
  });

  it('403 no sitemap → status blocked', async () => {
    const fakeFetch = async (url: string | URL) => {
      if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response('forbidden', { status: 403 });
    };
    const sd = await discoverViaSitemap({
      supplier: makeSupplier(),
      query: 'x',
      fetchFn: fakeFetch as typeof fetch,
    });
    assert.equal(sd.fetchStatus, 'blocked');
  });
});

// ─── Mapper ────────────────────────────────────────────────────────────────

describe('mapDiscoveredUrlsToCandidates', () => {
  it('dedup, filtra domínio, define source e status candidate', () => {
    const urls = [
      { url: 'https://www.kabum.com.br/produto/111/ssd-1tb' },
      { url: 'https://www.kabum.com.br/produto/111/ssd-1tb?utm_source=x' }, // dup após limpar tracking
      { url: 'https://outro-site.com/produto/999' }, // domínio diferente
      { url: 'https://www.kabum.com.br/categoria/ssd' }, // categoria → filtrada
    ];
    const inputs = mapDiscoveredUrlsToCandidates(
      urls,
      makeSupplier(),
      'ssd 1tb',
      'ssd 1tb',
      'firecrawl_search',
    );
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]!.source, 'firecrawl_search');
    assert.equal(inputs[0]!.status, 'candidate');
    assert.ok(inputs[0]!.productUrl.includes('/produto/111/'));
  });

  it('array vazio → array vazio', () => {
    const inputs = mapDiscoveredUrlsToCandidates([], makeSupplier(), 'q', 'q', 'sitemap');
    assert.equal(inputs.length, 0);
  });
});

// ─── Orchestrator ──────────────────────────────────────────────────────────

describe('runCatalogDiscovery', () => {
  it('salva candidatos com source correta e cria+finaliza run', async () => {
    const { service, calls } = makeFakeCatalog();
    const { client } = fakeSearchClient({
      status: 'success',
      elapsedMs: 10,
      items: [
        { url: 'https://www.kabum.com.br/produto/111/ssd-1tb' },
        { url: 'https://www.kabum.com.br/produto/222/ssd-2tb' },
      ],
    });

    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme', sources: ['firecrawl_search'] },
      {
        catalogService: service,
        firecrawlSearchClient: client,
        firecrawlMapClient: null,
        searchPageProvider: null,
      },
    );

    assert.equal(result.candidatesSaved, 2);
    assert.equal(calls.upserts.length, 2);
    assert.ok(calls.upserts.every((u) => u.source === 'firecrawl_search'));
    assert.equal(calls.createdRuns.length, 1);
    assert.equal(calls.finishedRuns.length, 1);
    assert.equal(calls.finishedRuns[0]!.status, 'completed');
    assert.equal(calls.finishedRuns[0]!.saved, 2);
  });

  it('combina múltiplas fontes e registra um run por fonte', async () => {
    const { service, calls } = makeFakeCatalog();
    const { client: sc } = fakeSearchClient({
      status: 'success',
      elapsedMs: 1,
      items: [{ url: 'https://www.kabum.com.br/produto/111/a' }],
    });
    const { client: mc } = fakeMapClient({
      status: 'success',
      elapsedMs: 1,
      items: [{ url: 'https://www.kabum.com.br/produto/222/b' }],
    });
    const sitemapXml = `<urlset><url><loc>https://www.kabum.com.br/produto/333/c</loc></url></urlset>`;
    const sitemapFetch = async (url: string | URL) =>
      String(url).endsWith('/sitemap.xml')
        ? new Response(sitemapXml, { status: 200 })
        : new Response('404', { status: 404 });

    const result = await runCatalogDiscovery(
      {
        supplier: makeSupplier(),
        query: 'ssd',
        sources: ['firecrawl_search', 'firecrawl_map', 'sitemap'],
      },
      {
        catalogService: service,
        firecrawlSearchClient: sc,
        firecrawlMapClient: mc,
        sitemapFetch: sitemapFetch as typeof fetch,
        searchPageProvider: null,
      },
    );

    assert.equal(result.candidatesSaved, 3);
    assert.equal(calls.createdRuns.length, 3);
    assert.equal(result.sourceBreakdown.length, 3);
    assert.deepEqual(
      calls.createdRuns.map((r) => r.source).sort(),
      ['firecrawl_map', 'firecrawl_search', 'sitemap'],
    );
  });

  it('no_candidates quando a fonte não retorna nada útil', async () => {
    const { service, calls } = makeFakeCatalog();
    const { client } = fakeSearchClient({ status: 'success', elapsedMs: 1, items: [] });

    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd', sources: ['firecrawl_search'] },
      { catalogService: service, firecrawlSearchClient: client, firecrawlMapClient: null, searchPageProvider: null },
    );

    assert.equal(result.candidatesSaved, 0);
    assert.equal(calls.finishedRuns[0]!.status, 'no_candidates');
  });

  it('blocked vira status controlado no run', async () => {
    const { service, calls } = makeFakeCatalog();
    const { client } = fakeSearchClient({ status: 'blocked', elapsedMs: 1, items: [], errorMessage: 'bloqueado' });

    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd', sources: ['firecrawl_search'] },
      { catalogService: service, firecrawlSearchClient: client, firecrawlMapClient: null, searchPageProvider: null },
    );

    assert.equal(calls.finishedRuns[0]!.status, 'blocked');
    assert.equal(result.candidatesSaved, 0);
  });

  it('rate_limited → run failed (controlado, não lança)', async () => {
    const { service, calls } = makeFakeCatalog();
    const { client } = fakeSearchClient({ status: 'rate_limited', elapsedMs: 1, items: [], errorMessage: 'limite' });

    await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd', sources: ['firecrawl_search'] },
      { catalogService: service, firecrawlSearchClient: client, firecrawlMapClient: null, searchPageProvider: null },
    );

    assert.equal(calls.finishedRuns[0]!.status, 'failed');
  });

  it('fonte Firecrawl desabilitada (client null) → skipped, sem run', async () => {
    const { service, calls } = makeFakeCatalog();
    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd', sources: ['firecrawl_search'] },
      { catalogService: service, firecrawlSearchClient: null, firecrawlMapClient: null, searchPageProvider: null },
    );
    assert.equal(calls.createdRuns.length, 0);
    assert.equal(result.sourceBreakdown[0]!.status, 'skipped');
  });

  it('lê matches reutilizáveis e não vaza nada de IA/chave', async () => {
    const { service, calls } = makeFakeCatalog(3);
    const { client } = fakeSearchClient({
      status: 'success',
      elapsedMs: 1,
      items: [{ url: 'https://www.kabum.com.br/produto/111/a' }],
    });
    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd', sources: ['firecrawl_search'] },
      { catalogService: service, firecrawlSearchClient: client, firecrawlMapClient: null, searchPageProvider: null },
    );
    assert.equal(result.reusableMatches, 3);
    assert.equal(calls.reusableQueried, 1);
    // Nenhuma referência a IA/Gemini ou chave no resultado serializado.
    const serialized = JSON.stringify(result).toLowerCase();
    assert.ok(!serialized.includes('gemini'));
    assert.ok(!serialized.includes('openai'));
    assert.ok(!serialized.includes('fc-'));
  });

  it('search_page usa o FetchProvider mockado e extrai candidatos do HTML', async () => {
    const { service, calls } = makeFakeCatalog();
    const html = `<html><body>
      <a href="https://www.kabum.com.br/produto/111/ssd-1tb-nvme">SSD 1TB</a>
      <a href="https://www.kabum.com.br/categoria/ssd">Categoria</a>
    </body></html>`;
    const fakeProvider: FetchProvider = {
      name: 'native',
      type: 'native',
      enabled: true,
      async fetchPage(input) {
        return { status: 'success', url: input.url, finalUrl: input.url, html, elapsedMs: 5 };
      },
    };
    const result = await runCatalogDiscovery(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme', sources: ['search_page'] },
      {
        catalogService: service,
        firecrawlSearchClient: null,
        firecrawlMapClient: null,
        searchPageProvider: fakeProvider,
      },
    );
    assert.equal(result.candidatesSaved, 1);
    assert.equal(calls.upserts[0]!.source, 'search_page');
  });
});

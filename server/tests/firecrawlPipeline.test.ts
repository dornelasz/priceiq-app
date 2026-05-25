/**
 * Etapa 11 — pipeline próprio com Firecrawl como coletor principal.
 *
 * Providers MOCKADOS (sem rede real). Cobre:
 *  - resolveProvidersFromConfig: enabled=false → só native; enabled=true → firecrawl+native
 *  - parseProviderPriority
 *  - pipeline usa Firecrawl primeiro quando enabled (native não é chamado)
 *  - pipeline cai para NativeFetcher quando Firecrawl falha (rate_limited)
 *  - pipeline passa markdown do Firecrawl ao localProductExtractor
 *  - links do Firecrawl entram no discovery próprio
 *  - budget limita chamadas Firecrawl (maxFirecrawlCalls)
 *  - diagnostics mostram provider firecrawl + usedFallback
 *  - IA/Gemini continuam desligados (aiCalls = 0)
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  runOwnSearchPipeline,
  resolveProvidersFromConfig,
  parseProviderPriority,
} = await import('../suppliers/v2/searchEngine/index.js');

type Supplier = import('../services/supplierService.js').Supplier;
type FetchProvider = import('../suppliers/v2/searchEngine/index.js').FetchProvider;
type FetchProviderResult =
  import('../suppliers/v2/searchEngine/index.js').FetchProviderResult;
type FetchProviderStatus =
  import('../suppliers/v2/searchEngine/index.js').FetchProviderStatus;
type SearchBudget = import('../suppliers/v2/searchEngine/index.js').SearchBudget;
type ProviderPolicy =
  import('../suppliers/v2/searchEngine/index.js').ProviderPolicy;

// ─── Fixtures ──────────────────────────────────────────────────────────────

const SEARCH_PAGE_ONE = `
<html><body>
<a href="/produto/notebook-dell-i5">Notebook Dell i5</a>
<a href="/login">Login</a>
</body></html>`;

const SEARCH_PAGE_NO_LINKS = `<html><body><p>resultados</p></body></html>`;

const PRODUCT_VALIDATED_FREE = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Notebook Dell Inspiron 15 i5 16GB",
  "offers": { "@type": "Offer", "price": "4599.90", "priceCurrency": "BRL" } }
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1><span>frete grátis</span></body></html>`;

const PRODUCT_HTML_NO_PRICE = `<html><body><h1>Notebook Dell Inspiron 15 i5 16GB</h1></body></html>`;
const PRODUCT_MD_WITH_PRICE = `# Notebook Dell Inspiron 15 i5 16GB

R$ 4.599,90

frete grátis para todo o Brasil`;

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Loja Teste',
    site: 'https://loja.test',
    search_url_template: 'https://loja.test/busca?q={q}',
    currency: 'BRL',
    country: 'BR',
    type: 'store',
    active: true,
    extraction_mode: 'auto',
    extractor_config: {},
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as Supplier;
}

const isSearch = (url: string) => url.includes('/busca');

function makeProvider(
  type: FetchProvider['type'],
  name: string,
  handler: (url: string) => Partial<FetchProviderResult> & { status: FetchProviderStatus },
): { provider: FetchProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: FetchProvider = {
    name,
    type,
    enabled: true,
    async fetchPage({ url }) {
      calls.push(url);
      return { url, elapsedMs: 1, ...handler(url) };
    },
  };
  return { provider, calls };
}

function firecrawlBudget(over: Partial<SearchBudget> = {}): Partial<SearchBudget> {
  return {
    maxExternalFetches: 5,
    maxFirecrawlCalls: 5,
    maxFirecrawlCreditsEstimated: 20,
    maxNativeFetches: 6,
    maxCandidateUrls: 5,
    maxFetchesPerSupplier: 12,
    ...over,
  };
}

const FIRECRAWL_POLICY: Partial<ProviderPolicy> = {
  firecrawlEnabled: true,
  preferFirecrawlFirst: true,
  providerPriority: ['firecrawl', 'native'],
};

// ─── resolveProvidersFromConfig ──────────────────────────────────────────────

describe('resolveProvidersFromConfig + parseProviderPriority', () => {
  it('parseProviderPriority normaliza e sempre garante native', () => {
    assert.deepEqual(parseProviderPriority('firecrawl,native'), ['firecrawl', 'native']);
    assert.deepEqual(parseProviderPriority('native'), ['native']);
    assert.deepEqual(parseProviderPriority(''), ['native']);
    assert.deepEqual(parseProviderPriority('foo,firecrawl'), ['firecrawl', 'native']);
  });

  it('FIRECRAWL_ENABLED=false → só NativeFetcher', () => {
    const fakeCfg = { FIRECRAWL_ENABLED: false } as unknown as Parameters<typeof resolveProvidersFromConfig>[0];
    const { providers, policy } = resolveProvidersFromConfig(fakeCfg);
    assert.equal(providers.length, 1);
    assert.equal(providers[0]!.type, 'native');
    assert.equal(policy.firecrawlEnabled, false);
  });

  it('FIRECRAWL_ENABLED=true → Firecrawl primeiro + Native fallback + orçamento', () => {
    const fakeCfg = {
      FIRECRAWL_ENABLED: true,
      FIRECRAWL_API_KEY: 'fc-x',
      FIRECRAWL_API_URL: 'https://api.firecrawl.dev/v2',
      FIRECRAWL_TIMEOUT_MS: 60000,
      FIRECRAWL_MAX_PAGES_PER_SEARCH: 5,
      FIRECRAWL_MAX_CREDITS_PER_SEARCH: 10,
      FETCH_PROVIDER_PRIORITY: 'firecrawl,native',
    } as unknown as Parameters<typeof resolveProvidersFromConfig>[0];
    const { providers, policy, budget } = resolveProvidersFromConfig(fakeCfg);
    assert.deepEqual(providers.map((p) => p.type), ['firecrawl', 'native']);
    assert.equal(policy.firecrawlEnabled, true);
    assert.equal(policy.preferFirecrawlFirst, true);
    assert.equal(budget.maxFirecrawlCalls, 5);
    assert.equal(budget.maxFirecrawlCreditsEstimated, 10);
  });
});

// ─── Pipeline com Firecrawl ──────────────────────────────────────────────────

describe('runOwnSearchPipeline — Firecrawl primeiro', () => {
  it('usa Firecrawl primeiro; NativeFetcher não é chamado quando Firecrawl funciona', async () => {
    const fc = makeProvider('firecrawl', 'firecrawl', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE, links: [] }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const native = makeProvider('native', 'native_fetch', () => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget(),
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(native.calls.length, 0, 'NativeFetcher não deve ser chamado');
    assert.ok(fc.calls.some(isSearch), 'Firecrawl coletou a busca');
    assert.deepEqual(out.providerPriority, ['firecrawl', 'native']);
    assert.equal(out.firecrawlEnabled, true);
    assert.equal(out.usedFallback, false);
    const search = out.attempts.find((a) => a.step === 'search_fetch');
    assert.equal(search?.providerName, 'firecrawl');
    assert.equal(search?.status, 'external_fetch_success');
  });

  it('passa markdown do Firecrawl ao localProductExtractor (preço só no markdown)', async () => {
    const fc = makeProvider('firecrawl', 'firecrawl', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE, links: [] }
        : { status: 'success', html: PRODUCT_HTML_NO_PRICE, markdown: PRODUCT_MD_WITH_PRICE },
    );
    const native = makeProvider('native', 'native_fetch', () => ({ status: 'blocked' }));

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget(),
    });

    // O preço só existe no markdown → validar prova que o markdown foi usado.
    assert.equal(out.result.status, 'validated');
    assert.equal(out.result.price, 4599.9);
    assert.equal(native.calls.length, 0);
  });

  it('links do Firecrawl entram no discovery (HTML da busca sem links)', async () => {
    const fcLink = 'https://loja.test/produto/notebook-dell-firecrawl';
    const fc = makeProvider('firecrawl', 'firecrawl', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_NO_LINKS, links: [fcLink] }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const native = makeProvider('native', 'native_fetch', () => ({ status: 'blocked' }));

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget(),
    });

    assert.equal(out.result.status, 'validated');
    assert.ok(out.candidateUrls.includes(fcLink), 'candidato veio dos links do Firecrawl');
    const discovery = out.attempts.find((a) => a.step === 'discovery');
    assert.ok((discovery?.linksFromProvider ?? 0) >= 1);
  });
});

describe('runOwnSearchPipeline — fallback para NativeFetcher', () => {
  it('Firecrawl rate_limited → cai para NativeFetcher (usedFallback)', async () => {
    const fc = makeProvider('firecrawl', 'firecrawl', () => ({ status: 'rate_limited' }));
    const native = makeProvider('native', 'native_fetch', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget(),
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.usedFallback, true);
    assert.ok(fc.calls.some(isSearch), 'Firecrawl foi tentado primeiro');
    assert.ok(native.calls.some(isSearch), 'NativeFetcher serviu como fallback');
    // diagnostics: o search_fetch do native deve marcar usedFallback
    const nativeSearch = out.attempts.find(
      (a) => a.step === 'search_fetch' && a.providerName === 'native_fetch',
    );
    assert.equal(nativeSearch?.usedFallback, true);
    assert.ok(nativeSearch?.fallbackReason?.includes('firecrawl'));
  });

  it('budget limita chamadas Firecrawl (maxFirecrawlCalls=1) → produto via Native', async () => {
    const fc = makeProvider('firecrawl', 'firecrawl', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE, links: [] }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const native = makeProvider('native', 'native_fetch', () => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget({ maxFirecrawlCalls: 1, maxFirecrawlCreditsEstimated: 2 }),
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.context.budgetUsage.firecrawlCalls, 1, 'só 1 chamada Firecrawl');
    assert.equal(out.context.budgetUsage.externalFetches, 1);
    // o produto teve que ser coletado pelo NativeFetcher (Firecrawl esgotado)
    assert.ok(native.calls.length >= 1, 'NativeFetcher coletou o produto');
  });

  it('IA/Gemini continuam desligados (aiCalls = 0)', async () => {
    const fc = makeProvider('firecrawl', 'firecrawl', (url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE, links: [] }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const native = makeProvider('native', 'native_fetch', () => ({ status: 'blocked' }));

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProviders: [fc.provider, native.provider],
      providerPolicy: FIRECRAWL_POLICY,
      budget: firecrawlBudget(),
    });

    assert.equal(out.context.budgetUsage.aiCalls, 0);
    assert.equal(out.context.providerPolicy.aiEnabled, false);
  });
});

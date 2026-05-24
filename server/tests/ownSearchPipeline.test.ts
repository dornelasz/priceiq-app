/**
 * Etapa 7 — pipeline próprio executável com NativeFetcher.
 *
 * Cobre o fluxo ponta a ponta com FetchProvider MOCKADO (sem rede real):
 *  - busca página de busca, descobre candidatos, busca produto, extrai validated
 *  - extrai partial (V2 validated + freightStatus not_available) quando sem frete
 *  - continua para o próximo candidato em mismatch / sem preço
 *  - mapeia blocked/timeout da busca para status controlado
 *  - not_found quando não há candidatos
 *  - respeita maxCandidateUrls e maxNativeFetches
 *  - NÃO chama Firecrawl nem IA (gating permanece desligado)
 *  - registra diagnostics de cada passo
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { runOwnSearchPipeline, shouldTryExternalFetcher, shouldTryAI } =
  await import('../suppliers/v2/searchEngine/index.js');

type Supplier = import('../services/supplierService.js').Supplier;
type FetchProvider = import('../suppliers/v2/searchEngine/index.js').FetchProvider;
type FetchProviderResult =
  import('../suppliers/v2/searchEngine/index.js').FetchProviderResult;
type FetchProviderStatus =
  import('../suppliers/v2/searchEngine/index.js').FetchProviderStatus;

// ─── Fixtures HTML ──────────────────────────────────────────────────────

const SEARCH_PAGE_ONE = `
<html><body>
<a href="/produto/notebook-dell-i5">Notebook Dell i5</a>
<a href="/category/notebooks">Categoria</a>
<a href="/login">Login</a>
<a href="/cart">Carrinho</a>
</body></html>`;

const SEARCH_PAGE_TWO = `
<html><body>
<a href="/produto/primeiro-item">Primeiro</a>
<a href="/produto/segundo-item">Segundo</a>
</body></html>`;

const SEARCH_PAGE_THREE = `
<html><body>
<a href="/produto/item-a">A</a>
<a href="/produto/item-b">B</a>
<a href="/produto/item-c">C</a>
</body></html>`;

const SEARCH_PAGE_NO_PRODUCTS = `
<html><body>
<a href="/category/notebooks">Categoria</a>
<a href="/login">Login</a>
<a href="/cart">Carrinho</a>
</body></html>`;

const PRODUCT_VALIDATED_FREE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Notebook Dell Inspiron 15 i5 16GB",
  "offers": { "@type": "Offer", "price": "4599.90", "priceCurrency": "BRL" }
}
</script>
</head><body>
<h1>Notebook Dell Inspiron 15</h1>
<p>R$ 4.599,90</p>
<span>frete grátis para todo o Brasil</span>
</body></html>`;

const PRODUCT_VALIDATED_NO_FREIGHT = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Notebook Dell Inspiron 15 i5 16GB",
  "offers": { "@type": "Offer", "price": "4599.90", "priceCurrency": "BRL" }
}
</script>
</head><body>
<h1>Notebook Dell Inspiron 15</h1>
<p>R$ 4.599,90</p>
</body></html>`;

const PRODUCT_MISMATCH = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Geladeira Brastemp Frost Free 400L",
  "offers": { "@type": "Offer", "price": "3299.00", "priceCurrency": "BRL" }
}
</script>
</head><body><h1>Geladeira Brastemp</h1></body></html>`;

const PRODUCT_NO_PRICE = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Notebook Dell Inspiron 15 i5 16GB" }
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1></body></html>`;

// ─── Helpers ────────────────────────────────────────────────────────────

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

/** FetchProvider mockado por função roteadora de URL → resultado. */
function fnProvider(
  handler: (url: string) => Partial<FetchProviderResult> & { status: FetchProviderStatus },
): { provider: FetchProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: FetchProvider = {
    name: 'mock_native',
    type: 'native',
    enabled: true,
    async fetchPage({ url }) {
      calls.push(url);
      return { url, elapsedMs: 1, ...handler(url) };
    },
  };
  return { provider, calls };
}

const isSearch = (url: string) => url.includes('/busca');

// ─── Caminho feliz ─────────────────────────────────────────────────────

describe('runOwnSearchPipeline — caminho feliz', () => {
  it('busca, descobre candidato, busca produto e extrai validated', async () => {
    const { provider, calls } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.result.freightStatus, 'free_confirmed');
    assert.equal(out.result.productName, 'Notebook Dell Inspiron 15 i5 16GB');
    assert.ok(out.candidateUrls.length >= 1, 'deve ter testado ao menos 1 candidato');
    assert.ok(out.candidateUrls[0]!.includes('/produto/notebook-dell-i5'));
    // 1 fetch da busca + 1 fetch do produto
    assert.equal(calls.length, 2);
    assert.ok(isSearch(calls[0]!), 'primeiro fetch deve ser a página de busca');
    assert.ok(out.elapsedMs >= 0);
  });

  it('extrai partial (validated + freightStatus not_available) quando não há frete', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_NO_FREIGHT },
    );

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.result.freightStatus, 'not_available');
    // diagnostics de extração devem registrar 'partial'
    const finalize = out.attempts.find((a) => a.step === 'finalize');
    assert.equal(finalize?.status, 'partial');
  });
});

// ─── Continuação entre candidatos ────────────────────────────────────────

describe('runOwnSearchPipeline — iteração de candidatos', () => {
  it('continua para o próximo candidato quando o primeiro é mismatch', async () => {
    const { provider, calls } = fnProvider((url) => {
      if (isSearch(url)) return { status: 'success', html: SEARCH_PAGE_TWO };
      if (url.includes('primeiro-item')) return { status: 'success', html: PRODUCT_MISMATCH };
      return { status: 'success', html: PRODUCT_VALIDATED_FREE };
    });

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.candidateUrls.length, 2, 'ambos os candidatos devem ter sido testados');
    assert.ok(calls.some((c) => c.includes('primeiro-item')));
    assert.ok(calls.some((c) => c.includes('segundo-item')));
  });

  it('continua para o próximo candidato quando o primeiro não tem preço', async () => {
    const { provider } = fnProvider((url) => {
      if (isSearch(url)) return { status: 'success', html: SEARCH_PAGE_TWO };
      if (url.includes('primeiro-item')) return { status: 'success', html: PRODUCT_NO_PRICE };
      return { status: 'success', html: PRODUCT_VALIDATED_FREE };
    });

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'validated');
    assert.equal(out.candidateUrls.length, 2);
  });

  it('retorna product_mismatch quando só achou produto incompatível', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_MISMATCH },
    );

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'product_mismatch');
  });

  it('retorna price_not_found quando achou produto sem preço', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_NO_PRICE },
    );

    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    assert.equal(out.result.status, 'price_not_found');
  });
});

// ─── Falhas de coleta ────────────────────────────────────────────────────

describe('runOwnSearchPipeline — falhas controladas', () => {
  it('retorna blocked quando a busca bloqueia', async () => {
    const { provider, calls } = fnProvider(() => ({ status: 'blocked' }));
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook',
      fetchProvider: provider,
    });
    assert.equal(out.result.status, 'blocked');
    assert.equal(calls.length, 1, 'só deve ter tentado a busca');
  });

  it('retorna timeout quando a busca dá timeout', async () => {
    const { provider } = fnProvider(() => ({ status: 'timeout' }));
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook',
      fetchProvider: provider,
    });
    assert.equal(out.result.status, 'timeout');
  });

  it('retorna not_found quando a busca não tem candidatos de produto', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_NO_PRODUCTS }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook',
      fetchProvider: provider,
    });
    assert.equal(out.result.status, 'not_found');
    assert.equal(out.candidateUrls.length, 0);
  });

  it('retorna blocked quando todos os candidatos bloqueiam', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'blocked' },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });
    assert.equal(out.result.status, 'blocked');
  });

  it('retorna needs_supplier_setup quando não há URL de busca válida', async () => {
    const { provider, calls } = fnProvider(() => ({ status: 'success', html: '' }));
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier({ site: '', search_url_template: '' }),
      query: 'notebook',
      fetchProvider: provider,
    });
    assert.equal(out.result.status, 'needs_supplier_setup');
    assert.equal(calls.length, 0, 'não deve nem tentar buscar');
  });
});

// ─── Orçamento ───────────────────────────────────────────────────────────

describe('runOwnSearchPipeline — orçamento', () => {
  it('respeita maxCandidateUrls', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_THREE }
        : { status: 'success', html: PRODUCT_MISMATCH },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
      budget: { maxCandidateUrls: 1 },
    });
    assert.equal(out.candidateUrls.length, 1, 'só pode testar 1 candidato');
    assert.equal(out.context.budgetUsage.candidateUrls, 1);
  });

  it('respeita maxNativeFetches', async () => {
    const { provider, calls } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_THREE }
        : { status: 'success', html: PRODUCT_MISMATCH },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
      budget: { maxNativeFetches: 2 },
    });
    // 1 busca + 1 produto = 2 fetches; 3º candidato barrado pelo orçamento
    assert.equal(calls.length, 2);
    assert.equal(out.context.budgetUsage.nativeFetches, 2);
  });
});

// ─── Sem Firecrawl, sem IA ────────────────────────────────────────────────

describe('runOwnSearchPipeline — sem providers externos', () => {
  it('não liga Firecrawl (shouldTryExternalFetcher permanece false)', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });
    assert.equal(shouldTryExternalFetcher(out.context), false);
    assert.equal(out.context.providerPolicy.firecrawlEnabled, false);
    assert.equal(out.context.budgetUsage.externalFetches, 0);
  });

  it('não liga IA (shouldTryAI permanece false)', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });
    assert.equal(shouldTryAI(out.context), false);
    assert.equal(out.context.providerPolicy.aiEnabled, false);
    assert.equal(out.context.budgetUsage.aiCalls, 0);
  });
});

// ─── Diagnostics ─────────────────────────────────────────────────────────

describe('runOwnSearchPipeline — diagnostics', () => {
  it('registra cada passo do pipeline', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });

    const steps = out.attempts.map((a) => a.step);
    assert.ok(steps.includes('build_search_url'));
    assert.ok(steps.includes('search_fetch'));
    assert.ok(steps.includes('discovery'));
    assert.ok(steps.includes('product_fetch'));
    assert.ok(steps.includes('extraction'));
    assert.ok(steps.includes('finalize'));
    // attempts do outcome são o mesmo array do contexto
    assert.equal(out.attempts, out.context.diagnostics.attempts);
    // todo attempt é carimbado
    assert.ok(out.attempts.every((a) => a.at && a.step && a.status));
  });

  it('diagnostics registram a URL de busca e o status do fetch', async () => {
    const { provider } = fnProvider((url) =>
      isSearch(url)
        ? { status: 'success', html: SEARCH_PAGE_ONE }
        : { status: 'success', html: PRODUCT_VALIDATED_FREE },
    );
    const out = await runOwnSearchPipeline({
      supplier: makeSupplier(),
      query: 'notebook dell',
      fetchProvider: provider,
    });
    const build = out.attempts.find((a) => a.step === 'build_search_url');
    assert.ok(build?.url?.includes('/busca?q=notebook'));
    const search = out.attempts.find((a) => a.step === 'search_fetch');
    assert.equal(search?.status, 'native_fetch_success');
  });
});

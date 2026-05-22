/**
 * Testes do Recipe Runner + extractors estruturados (Fase D).
 *
 * Cobertura (35+ casos):
 *  - Extractors: jsonLd, metaTags, nextData, scriptJson, dom + freightHints.
 *  - Candidate extractor: positivos, negativos, URL relativa, limite 5.
 *  - Recipe validator: certified ok, unconfigured falha, sem template, sem id.
 *  - Recipe Runner end-to-end com Fetcher fake + Supplier fake (sem DB).
 *  - Contratos: resultados validated batem `isValidatedUniversalSearchResult`;
 *    `canConfirmFinalTotal` reflete corretamente o frete observado.
 *
 * Nenhum teste depende de internet real — só fixtures HTML.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  extractFromJsonLd,
  extractFromMetaTags,
  extractFromNextData,
  extractFromScriptJson,
  extractFromDom,
  detectFreeShipping,
  extractCandidates,
  validateRecipe,
  runSupplierRecipe,
  isValidatedUniversalSearchResult,
  canConfirmFinalTotal,
  matchProduct,
} = await import('../suppliers/v2/index.js');

type Fetcher = import('../suppliers/v2/index.js').Fetcher;
type FetcherResult = import('../suppliers/v2/index.js').FetcherResult;
type SupplierRecipe = import('../suppliers/v2/index.js').SupplierRecipe;
type Supplier = import('../services/supplierService.js').Supplier;
type UniversalSearchResult =
  import('../suppliers/v2/index.js').UniversalSearchResult;

// ─── Fixtures HTML ──────────────────────────────────────────────────────

const PRODUCT_JSON_LD_OK = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Notebook Dell Inspiron 15 i5 16GB",
  "url": "https://loja.com/produto/notebook-dell-inspiron-15",
  "image": "https://loja.com/img/notebook.jpg",
  "offers": {
    "@type": "Offer",
    "price": "4599.90",
    "priceCurrency": "BRL",
    "availability": "https://schema.org/InStock"
  }
}
</script>
</head><body>
<h1>Notebook Dell Inspiron 15</h1>
<p>R$ 4.599,90</p>
<button>Adicionar ao carrinho</button>
</body></html>`;

const PRODUCT_JSON_LD_NO_OFFER = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Cafeteira Italiana"
}
</script>
</head><body><h1>Cafeteira Italiana</h1></body></html>`;

const PRODUCT_META_TAGS = `
<html><head>
<meta property="og:type" content="product">
<meta property="og:title" content="Smartphone Galaxy A15 128GB">
<meta property="product:price:amount" content="1299.90">
<meta property="product:price:currency" content="BRL">
<meta property="og:url" content="https://loja.com/p/galaxy-a15">
<meta property="og:image" content="https://loja.com/img/a15.jpg">
</head><body><h1>Galaxy A15</h1></body></html>`;

const PRODUCT_NEXT_DATA = `
<html><body>
<h1>Smart TV LG 50 polegadas</h1>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"product":{"name":"Smart TV LG 50 polegadas 4K","price":2499.00,"currency":"BRL","url":"https://loja.com/produto/tv-lg-50"}}}}
</script>
</body></html>`;

const PRODUCT_SCRIPT_JSON = `
<html><body>
<h1>Mouse Logitech MX Master 3</h1>
<script type="application/json" id="state">
{"product":{"name":"Mouse Logitech MX Master 3","price":"899.00","currency":"BRL"}}
</script>
</body></html>`;

const PRODUCT_DOM_ONLY = `
<html><body>
<h1>Cafeteira Mokita Italiana Inox</h1>
<p>Preço: <strong>R$ 189,90</strong> à vista</p>
<button>Comprar</button>
</body></html>`;

const PRODUCT_PRICE_ONLY = `
<html><body>
<p>R$ 999,99</p>
</body></html>`;

const PRODUCT_FREE_SHIPPING = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Teclado Mecânico RGB",
  "offers": { "@type": "Offer", "price": "499.00", "priceCurrency": "BRL" }
}
</script>
</head><body>
<h1>Teclado Mecânico RGB</h1>
<p>R$ 499,00</p>
<span class="shipping">frete grátis para todo o Brasil</span>
</body></html>`;

const PRODUCT_ACCESSORY = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Capinha Capa Case Silicone para iPhone 15",
  "offers": { "@type": "Offer", "price": "29.90", "priceCurrency": "BRL" }
}
</script>
</head><body><h1>Capinha para iPhone 15</h1></body></html>`;

const SEARCH_PAGE = `
<html><body>
<a href="/produto/notebook-dell-i5">Notebook Dell i5</a>
<a href="/category/notebooks">Categoria notebooks</a>
<a href="/products/teclado-mecanico">Teclado Mecânico</a>
<a href="/checkout">Checkout</a>
<a href="/blog/notebook-melhor">Blog</a>
<a href="/login">Login</a>
<a href="https://loja.com/dp/B0CABC123">Amazon item</a>
<a href="javascript:void(0)">JS</a>
<a href="#section">Anchor</a>
</body></html>`;

const SEARCH_PAGE_EMPTY = `
<html><body><p>Nenhum resultado encontrado.</p></body></html>`;

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

type FetchRule = [RegExp, FetcherResult];

function createScriptedFetcher(rules: FetchRule[]): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchText(url) {
      calls.push(url);
      for (const [rx, response] of rules) {
        if (rx.test(url)) return response;
      }
      return { status: 'error', error: 'no fixture' };
    },
  };
}

// ─── 1–7. Extractors ────────────────────────────────────────────────────

describe('extractor — jsonLdExtractor', () => {
  it('extrai nome/preço/moeda/url/evidence de Product+Offer', () => {
    const r = extractFromJsonLd(PRODUCT_JSON_LD_OK, 'https://loja.com/p/notebook');
    assert.ok(r);
    assert.equal(r!.strategy, 'json_ld');
    assert.equal(r!.productName, 'Notebook Dell Inspiron 15 i5 16GB');
    assert.equal(r!.price, 4599.9);
    assert.equal(r!.currency, 'BRL');
    assert.equal(r!.available, true);
    assert.ok(r!.evidenceText && r!.evidenceText.length > 0);
    assert.equal(r!.confidence, 90);
  });

  it('retorna parcial quando JSON-LD não tem Offer/price', () => {
    const r = extractFromJsonLd(PRODUCT_JSON_LD_NO_OFFER, 'https://loja.com/x');
    assert.ok(r);
    assert.equal(r!.productName, 'Cafeteira Italiana');
    assert.equal(r!.price, undefined);
    assert.ok(r!.confidence < 50);
  });
});

describe('extractor — metaTagExtractor', () => {
  it('extrai preço/moeda/title de product:price + og:title', () => {
    const r = extractFromMetaTags(PRODUCT_META_TAGS, 'https://loja.com/x');
    assert.ok(r);
    assert.equal(r!.strategy, 'meta_tags');
    assert.equal(r!.productName, 'Smartphone Galaxy A15 128GB');
    assert.equal(r!.price, 1299.9);
    assert.equal(r!.currency, 'BRL');
    assert.equal(r!.productUrl, 'https://loja.com/p/galaxy-a15');
    assert.ok(r!.confidence >= 70);
  });
});

describe('extractor — nextDataExtractor', () => {
  it('extrai produto/preço de __NEXT_DATA__ aninhado', () => {
    const r = extractFromNextData(PRODUCT_NEXT_DATA, 'https://loja.com/x');
    assert.ok(r);
    assert.equal(r!.strategy, 'next_data');
    assert.equal(r!.productName, 'Smart TV LG 50 polegadas 4K');
    assert.equal(r!.price, 2499);
    assert.equal(r!.currency, 'BRL');
  });

  it('retorna null se __NEXT_DATA__ não tem produto', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>`;
    const r = extractFromNextData(html, 'https://loja.com/x');
    assert.equal(r, null);
  });
});

describe('extractor — scriptJsonExtractor', () => {
  it('extrai produto+preço quando há sinal forte', () => {
    const r = extractFromScriptJson(PRODUCT_SCRIPT_JSON, 'https://loja.com/x');
    assert.ok(r);
    assert.equal(r!.strategy, 'script_json');
    assert.equal(r!.productName, 'Mouse Logitech MX Master 3');
    assert.equal(r!.price, 899);
  });

  it('é conservador — script JSON sem sinal de produto não retorna nada', () => {
    const html = `<script type="application/json">{"banner":{"id":1}}</script>`;
    const r = extractFromScriptJson(html, 'https://loja.com/x');
    assert.equal(r, null);
  });
});

describe('extractor — domExtractor', () => {
  it('extrai h1 + preço textual com confiança baixa', () => {
    const r = extractFromDom(PRODUCT_DOM_ONLY, 'https://loja.com/x');
    assert.ok(r);
    assert.equal(r!.strategy, 'dom');
    assert.equal(r!.productName, 'Cafeteira Mokita Italiana Inox');
    assert.equal(r!.price, 189.9);
    assert.equal(r!.currency, 'BRL');
    assert.ok(r!.confidence < 60);
  });

  it('rejeita preço solto sem nome (sem h1/title)', () => {
    const r = extractFromDom(PRODUCT_PRICE_ONLY, 'https://loja.com/x');
    assert.equal(r, null);
  });
});

describe('extractor — freightHints', () => {
  it('detecta "frete grátis" no HTML', () => {
    const r = detectFreeShipping(PRODUCT_FREE_SHIPPING);
    assert.equal(r.isFreeShipping, true);
    assert.ok(r.evidence && /frete\s*gr/i.test(r.evidence));
  });

  it('retorna false quando não há sinal de frete grátis', () => {
    const r = detectFreeShipping(PRODUCT_JSON_LD_OK);
    assert.equal(r.isFreeShipping, false);
    assert.equal(r.evidence, null);
  });
});

// ─── 8–11. Candidate extractor ─────────────────────────────────────────

describe('candidateExtractor', () => {
  it('extrai links /products/, /produto/, /dp/, MLB-', () => {
    const r = extractCandidates({
      searchPageHtml: SEARCH_PAGE,
      searchPageUrl: 'https://loja.com/search?q=teste',
      baseUrl: 'https://loja.com',
    });
    const urls = r.candidates.map((c) => c.url);
    assert.ok(urls.some((u) => u.includes('/produto/notebook')));
    assert.ok(urls.some((u) => u.includes('/products/teclado')));
    assert.ok(urls.some((u) => u.includes('/dp/B0CABC123')));
  });

  it('resolve URL relativa contra searchPageUrl', () => {
    const r = extractCandidates({
      searchPageHtml: `<a href="/produto/x">x</a>`,
      searchPageUrl: 'https://loja.com/search',
      baseUrl: 'https://loja.com',
    });
    assert.equal(r.candidates[0]?.url, 'https://loja.com/produto/x');
  });

  it('rejeita cart/checkout/login/category/blog/contato/javascript:', () => {
    const r = extractCandidates({
      searchPageHtml: SEARCH_PAGE,
      searchPageUrl: 'https://loja.com/search?q=teste',
      baseUrl: 'https://loja.com',
    });
    const urls = r.candidates.map((c) => c.url);
    assert.ok(!urls.some((u) => u.includes('/category/')));
    assert.ok(!urls.some((u) => u.includes('/checkout')));
    assert.ok(!urls.some((u) => u.includes('/login')));
    assert.ok(!urls.some((u) => u.includes('/blog/')));
    assert.ok(!urls.some((u) => u.includes('javascript:')));
  });

  it('limita a 5 candidatos', () => {
    const manyLinks = Array.from(
      { length: 20 },
      (_, i) => `<a href="/produto/p${i}">Produto ${i}</a>`,
    ).join('');
    const r = extractCandidates({
      searchPageHtml: manyLinks,
      searchPageUrl: 'https://loja.com/search',
      baseUrl: 'https://loja.com',
    });
    assert.ok(r.candidates.length <= 5);
  });
});

// ─── 12–15. Recipe validator ──────────────────────────────────────────

describe('recipeValidator', () => {
  it('aceita receita certified com searchUrlTemplate válida', () => {
    const r = validateRecipe(makeRecipe());
    assert.equal(r.valid, true);
  });

  it('rejeita receita unconfigured (needs_supplier_setup)', () => {
    const r = validateRecipe(makeRecipe({ status: 'unconfigured' }));
    assert.equal(r.valid, false);
    assert.ok(r.reason);
  });

  it('rejeita receita sem searchUrlTemplate', () => {
    const r = validateRecipe(makeRecipe({ searchUrlTemplate: null }));
    assert.equal(r.valid, false);
  });

  it('rejeita receita com template sem placeholder {query}/{q}/{produto}', () => {
    const r = validateRecipe(
      makeRecipe({ searchUrlTemplate: 'https://loja.com/search' }),
    );
    assert.equal(r.valid, false);
  });

  it('rejeita receita sem supplierId', () => {
    const r = validateRecipe(makeRecipe({ supplierId: '' }));
    assert.equal(r.valid, false);
  });

  it('rejeita receita null', () => {
    const r = validateRecipe(null);
    assert.equal(r.valid, false);
  });
});

// ─── 16–35. Recipe Runner ─────────────────────────────────────────────

describe('runSupplierRecipe — receita não certified', () => {
  it('retorna needs_supplier_setup quando receita está unconfigured', async () => {
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe({ status: 'unconfigured' }),
      query: 'notebook',
      fetcher: createScriptedFetcher([]),
    });
    assert.equal(r.status, 'needs_supplier_setup');
    assert.equal(r.found, false);
  });
});

describe('runSupplierRecipe — search page bloqueada', () => {
  it('retorna blocked quando search page vem com status=blocked', async () => {
    const fetcher = createScriptedFetcher([
      [/\/search\?/, { status: 'blocked', httpStatus: 403, html: '' }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook',
      fetcher,
    });
    assert.equal(r.status, 'blocked');
  });

  it('mapeia requires_login para blocked (V2 não tem requires_login)', async () => {
    const fetcher = createScriptedFetcher([
      [/\/search\?/, { status: 'requires_login', httpStatus: 401, html: '' }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook',
      fetcher,
    });
    assert.equal(r.status, 'blocked');
    assert.ok(r.errorMessage?.includes('login'));
  });
});

describe('runSupplierRecipe — sem candidatos', () => {
  it('retorna not_found quando search page não tem candidatos', async () => {
    const fetcher = createScriptedFetcher([
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE_EMPTY }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook',
      fetcher,
    });
    assert.equal(r.status, 'not_found');
  });
});

describe('runSupplierRecipe — caminho feliz', () => {
  it('candidato com JSON-LD válido retorna validated', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/dp/B0CABC123' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/produto/notebook-dell-i5' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/products/teclado-mecanico' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook dell inspiron 15',
      fetcher,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.found, true);
    assert.equal(r.productName, 'Notebook Dell Inspiron 15 i5 16GB');
    assert.equal(r.price, 4599.9);
    assert.equal(r.currency, 'BRL');
    assert.equal(r.linkType, 'product');
    assert.equal(r.linkValidated, true);
    assert.ok(r.evidence?.evidenceText);
    assert.equal(isValidatedUniversalSearchResult(r), true);
  });

  it('candidato com meta tags válido retorna validated', async () => {
    const html = SEARCH_PAGE.replace(/Notebook Dell i5/, 'Galaxy A15 128GB');
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_META_TAGS, finalUrl: 'https://loja.com/dp/B0CABC123' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_META_TAGS, finalUrl: 'https://loja.com/produto/galaxy-a15' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_META_TAGS, finalUrl: 'https://loja.com/products/teclado-mecanico' }],
      [/\/search\?/, { status: 'ok', html }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe({ extractionStrategy: 'meta_tags' }),
      query: 'galaxy a15 128gb',
      fetcher,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.evidence?.strategy, 'meta_tags');
  });

  it('candidato com __NEXT_DATA__ válido retorna validated', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_NEXT_DATA, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_NEXT_DATA, finalUrl: 'https://loja.com/produto/tv-lg-50' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_NEXT_DATA, finalUrl: 'https://loja.com/products/teclado-mecanico' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe({ extractionStrategy: 'next_data' }),
      query: 'smart tv lg 50',
      fetcher,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.evidence?.strategy, 'next_data');
    assert.equal(r.price, 2499);
  });
});

describe('runSupplierRecipe — frete', () => {
  it('frete ausente → freight=null, freightStatus=not_available, totalPrice=null', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/produto/x' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/products/x' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook dell inspiron 15',
      fetcher,
    });
    assert.equal(r.freight, null);
    assert.equal(r.freightStatus, 'not_available');
    assert.equal(r.totalPrice, null);
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('frete grátis confirmado → freight=0, freightStatus=free_confirmed, totalPrice=price', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_FREE_SHIPPING, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_FREE_SHIPPING, finalUrl: 'https://loja.com/produto/teclado' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_FREE_SHIPPING, finalUrl: 'https://loja.com/products/teclado-rgb' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'teclado mecanico rgb',
      fetcher,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.freight, 0);
    assert.equal(r.freightStatus, 'free_confirmed');
    assert.equal(r.totalPrice, r.price);
    assert.equal(canConfirmFinalTotal(r), true);
  });
});

describe('runSupplierRecipe — produto sem preço', () => {
  it('retorna price_not_found quando todos os candidatos têm nome mas sem preço', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_JSON_LD_NO_OFFER, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_JSON_LD_NO_OFFER, finalUrl: 'https://loja.com/produto/cafeteira' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_NO_OFFER, finalUrl: 'https://loja.com/products/x' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'cafeteira italiana',
      fetcher,
    });
    assert.equal(r.status, 'price_not_found');
  });
});

describe('runSupplierRecipe — produto mismatch', () => {
  it('retorna product_mismatch quando produto é capinha mas query pede iPhone', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_ACCESSORY, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_ACCESSORY, finalUrl: 'https://loja.com/produto/capinha' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_ACCESSORY, finalUrl: 'https://loja.com/products/x' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'iphone 15',
      fetcher,
    });
    assert.equal(r.status, 'product_mismatch');
  });
});

describe('runSupplierRecipe — fallback entre candidatos', () => {
  it('um candidato ruim não impede testar próximo candidato válido', async () => {
    // O primeiro candidato a ser tentado é /dp/ (score 80). Mandamos vazio.
    // O próximo deveria ser /produto/ ou MLB- (também 80) ou /products/ (65).
    // O fetcher devolve OK só para /products/ — runner deve achar isso.
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: '<html><body>nada</body></html>', finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: '<html><body>nada</body></html>', finalUrl: 'https://loja.com/produto/x' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/products/notebook' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook dell inspiron 15',
      fetcher,
    });
    assert.equal(r.status, 'validated');
  });
});

describe('runSupplierRecipe — link de busca não vira product validado', () => {
  it('candidato com URL que cai no filtro de negativo nem aparece como candidato', () => {
    const r = extractCandidates({
      searchPageHtml: `<a href="https://loja.com/search?q=outro">Não vira candidato</a>`,
      searchPageUrl: 'https://loja.com/search',
      baseUrl: 'https://loja.com',
    });
    assert.equal(r.candidates.length, 0);
  });
});

describe('runSupplierRecipe — fetch error / timeout', () => {
  it('error de fetch na search page → status=error', async () => {
    const fetcher = createScriptedFetcher([
      [/\/search\?/, { status: 'error', error: 'ECONNRESET' }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook',
      fetcher,
    });
    assert.equal(r.status, 'error');
    assert.ok(r.errorMessage);
  });

  it('timeout no fetch → status=timeout', async () => {
    const fetcher = createScriptedFetcher([
      [/\/search\?/, { status: 'error', error: 'request timeout aborted' }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook',
      fetcher,
    });
    assert.equal(r.status, 'timeout');
  });
});

describe('runSupplierRecipe — contratos finais', () => {
  it('isValidatedUniversalSearchResult retorna true para resultado validated', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/produto/x' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/products/x' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook dell inspiron 15',
      fetcher,
    });
    assert.equal(isValidatedUniversalSearchResult(r), true);
  });

  it('canConfirmFinalTotal=false quando frete não disponível', async () => {
    const fetcher = createScriptedFetcher([
      [/\/dp\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/dp/X' }],
      [/\/produto\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/produto/x' }],
      [/\/products\//, { status: 'ok', html: PRODUCT_JSON_LD_OK, finalUrl: 'https://loja.com/products/x' }],
      [/\/search\?/, { status: 'ok', html: SEARCH_PAGE }],
    ]);
    const r: UniversalSearchResult = await runSupplierRecipe({
      supplier: makeSupplier(),
      recipe: makeRecipe(),
      query: 'notebook dell inspiron 15',
      fetcher,
    });
    assert.equal(canConfirmFinalTotal(r), false);
    assert.equal(r.freight, null);
    assert.equal(r.freightStatus, 'not_available');
  });
});

// ─── Sanidade do matcher interno (não conflita com matchingService antigo) ──

describe('matchProduct (matching interno V2)', () => {
  it('acerta produto exato', () => {
    const r = matchProduct('notebook dell inspiron 15', 'Notebook Dell Inspiron 15 i5 16GB');
    assert.ok(r.score >= 60);
    assert.equal(r.isAccessory, false);
  });

  it('flag isAccessory quando produto é capinha mas query é iPhone', () => {
    const r = matchProduct('iphone 15', 'Capinha Capa Case Silicone iPhone 15');
    assert.equal(r.isAccessory, true);
  });

  it('não flag accessory quando query é capinha', () => {
    const r = matchProduct('capinha iphone 15', 'Capinha Capa Silicone iPhone 15');
    assert.equal(r.isAccessory, false);
  });
});

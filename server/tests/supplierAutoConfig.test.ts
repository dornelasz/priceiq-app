/**
 * Testes do AutoConfig Engine (Fase C).
 *
 * Cobertura:
 *  - platformDetector: shopify, woocommerce, vtex, magento, nextjs, custom.
 *  - searchDiscoverer: form-detected, known-platform, legacy, none.
 *  - productPageDetector: candidatos, filtros negativos, isLikelyProductPage.
 *  - extractorDetector: json_ld, next_data, meta_tags, dom, null.
 *  - recipeBuilder: monta SupplierRecipe agregando os sinais.
 *  - supplierCertifier: certified/needs_guided_setup/blocked/requires_login
 *    /unsupported/failed + receita legada não vira certified.
 *  - autoConfigureSupplier: orquestração com fetcher e store fakes,
 *    incluindo cenário 404 (supplier inexistente) e fetch falho.
 *
 * Nenhum teste depende de internet real — todos usam fixtures HTML inline
 * e um Fetcher injetável.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  detectPlatform,
  discoverSearchUrl,
  detectProductCandidates,
  isLikelyProductPage,
  detectExtractionStrategy,
  buildSupplierRecipe,
  certifyRecipeCandidate,
  autoConfigureSupplier,
} = await import('../suppliers/v2/autoConfig/index.js');

type SupplierAutoConfigResult =
  import('../suppliers/v2/index.js').SupplierAutoConfigResult;
type SupplierRecipe = import('../suppliers/v2/index.js').SupplierRecipe;
type SupplierCertificationStatus =
  import('../suppliers/v2/index.js').SupplierCertificationStatus;
type Supplier = import('../services/supplierService.js').Supplier;
type Fetcher =
  import('../suppliers/v2/autoConfig/index.js').Fetcher;
type FetcherResult =
  import('../suppliers/v2/autoConfig/index.js').FetcherResult;
type SupplierStore =
  import('../suppliers/v2/autoConfig/index.js').SupplierStore;

// ─── Fixtures HTML ──────────────────────────────────────────────────────

const SHOPIFY_HOME = `
<!doctype html><html><head>
<link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/0001/style.css">
<script>window.Shopify = Shopify || {}; Shopify.theme = { name: "Dawn" };</script>
</head><body><div class="shopify-section"></div></body></html>`;

const WOO_HOME = `
<!doctype html><html><head><link rel="stylesheet"
href="https://example.com/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
</head><body class="woocommerce-page">
<script>jQuery(document).ready(function(){ wc_add_to_cart_params; });</script>
</body></html>`;

const VTEX_HOME = `
<!doctype html><html><head></head><body>
<script>window.__RUNTIME__={};</script>
<link rel="preload" href="/api/catalog_system/pub/products/search/notebook">
</body></html>`;

const MAGENTO_HOME = `
<!doctype html><html>
<body class="Magento_Theme">
<script src="/static/version1234567890/frontend/Magento/luma/en_US/mage/cookies.js"></script>
<a href="/catalogsearch/result/?q=test">Search</a>
</body></html>`;

const NEXTJS_HOME = `
<!doctype html><html><body>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
<script src="/_next/static/chunks/main.js"></script>
</body></html>`;

const CUSTOM_HOME = `
<!doctype html><html><head><title>Minha loja</title></head>
<body><h1>Bem-vindo</h1>
<form action="/buscar" method="get">
  <input type="text" name="q" placeholder="Buscar">
  <button>Ir</button>
</form>
</body></html>`;

const HOME_NO_FORM = `<!doctype html><html><body><h1>Empty</h1></body></html>`;

const SEARCH_PAGE_WITH_CANDIDATES = `
<html><body>
<a href="/produto/notebook-15-prata">Notebook 15 prata</a>
<a href="/category/notebooks">Notebooks (categoria)</a>
<a href="/products/teclado-mecanico-rgb">Teclado RGB</a>
<a href="/checkout/cart">Carrinho</a>
<a href="/login?redirect=/produto">Login</a>
<a href="/dp/B0CXXXXXXX">Amazon item</a>
<a href="https://produto.mercadolivre.com.br/MLB-1234567890-iphone">ML iPhone</a>
<a href="javascript:void(0)">JS link</a>
<a href="#section">anchor</a>
</body></html>`;

const PRODUCT_PAGE_JSON_LD = `
<html><head>
<meta property="og:type" content="product">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Notebook Dell Inspiron 15",
  "offers": {
    "@type": "Offer",
    "price": "4599.90",
    "priceCurrency": "BRL"
  }
}
</script>
</head><body>
<h1>Notebook Dell Inspiron 15</h1>
<p>R$ 4.599,90</p>
<button>Adicionar ao carrinho</button>
</body></html>`;

const PRODUCT_PAGE_NEXT_DATA = `
<html><head><meta property="og:type" content="product"></head>
<body>
<h1>Smartphone X</h1>
<p>R$ 2.499,00</p>
<button>Comprar agora</button>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"price":2499}}}}</script>
</body></html>`;

const PRODUCT_PAGE_META = `
<html><head>
<meta property="og:type" content="product">
<meta property="product:price:amount" content="129.90">
<meta property="product:price:currency" content="BRL">
</head><body><h1>Camiseta</h1></body></html>`;

const PRODUCT_PAGE_DOM_ONLY = `
<html><body>
<h1>Cafeteira Italiana</h1>
<p>R$ 189,90</p>
<button>Adicionar ao carrinho</button>
</body></html>`;

const PRODUCT_PAGE_GENERIC = `
<html><body><h1>Sobre nós</h1><p>Texto institucional.</p></body></html>`;

const BLOCKED_HTML = `
<html><head><title>Just a moment...</title></head>
<body>Please verify you are human. Cloudflare.</body></html>`;

// ─── Supplier fixture ───────────────────────────────────────────────────

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    name: 'Loja Teste',
    site: 'lojateste.com.br',
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
    certificationStatus: 'unconfigured',
    setupStatus: 'unconfigured',
    autoConfiguredAt: null,
    recipe: null,
    ...over,
  };
}

// ─── Fakes para orquestrador ────────────────────────────────────────────

type FetchRule = [RegExp, FetcherResult];

function createScriptedFetcher(
  rules: FetchRule[],
  fallback: FetcherResult = { status: 'error', error: 'no fixture' },
): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchText(url) {
      calls.push(url);
      for (const [rx, response] of rules) {
        if (rx.test(url)) return response;
      }
      return fallback;
    },
  };
}

function createMemoryStore(initial: Supplier): SupplierStore & {
  recipe: SupplierRecipe | null;
  statusUpdates: Array<{ status: SupplierCertificationStatus; setAuto?: boolean }>;
} {
  const state: {
    supplier: Supplier;
    recipe: SupplierRecipe | null;
    statusUpdates: Array<{
      status: SupplierCertificationStatus;
      setAuto?: boolean;
    }>;
  } = {
    supplier: { ...initial },
    recipe: null,
    statusUpdates: [],
  };

  return {
    get recipe() {
      return state.recipe;
    },
    get statusUpdates() {
      return state.statusUpdates;
    },
    async getSupplier(id) {
      if (id !== state.supplier.id) {
        const e = new Error('Fornecedor não encontrado') as Error & {
          statusCode: number;
          code: string;
        };
        e.statusCode = 404;
        e.code = 'NOT_FOUND';
        e.name = 'NotFoundError';
        throw e;
      }
      return state.supplier;
    },
    async upsertRecipe(supplierId, recipe) {
      const saved: SupplierRecipe = {
        id: state.recipe?.id ?? 'recipe-1',
        supplierId,
        status: recipe.status,
        platformDetected: recipe.platformDetected ?? null,
        searchUrlTemplate: recipe.searchUrlTemplate ?? null,
        productUrlPatterns: recipe.productUrlPatterns ?? [],
        extractionStrategy: recipe.extractionStrategy ?? null,
        titleSelector: recipe.titleSelector ?? null,
        priceSelector: recipe.priceSelector ?? null,
        currencySelector: recipe.currencySelector ?? null,
        imageSelector: recipe.imageSelector ?? null,
        availabilitySelector: recipe.availabilitySelector ?? null,
        jsonLdEnabled: recipe.jsonLdEnabled ?? false,
        jsonPaths: recipe.jsonPaths ?? null,
        requiresJs: recipe.requiresJs ?? false,
        requiresBrowser: recipe.requiresBrowser ?? false,
        confidence: recipe.confidence ?? null,
        lastTestedAt: recipe.lastTestedAt ?? null,
        lastSuccessAt: recipe.lastSuccessAt ?? null,
        lastError: recipe.lastError ?? null,
        configJson: recipe.configJson ?? null,
      };
      state.recipe = saved;
      return saved;
    },
    async updateCertificationStatus(_id, status, opts) {
      state.statusUpdates.push({ status, setAuto: opts?.setAutoConfiguredAt });
      state.supplier = {
        ...state.supplier,
        certificationStatus: status,
        setupStatus: status,
        autoConfiguredAt: opts?.setAutoConfiguredAt
          ? new Date().toISOString()
          : state.supplier.autoConfiguredAt,
      };
    },
    async getRecipe() {
      return state.recipe;
    },
  };
}

// ─── 1. Platform Detector ───────────────────────────────────────────────

describe('platformDetector', () => {
  it('detecta Shopify', () => {
    const r = detectPlatform({
      baseUrl: 'https://shop.example',
      homepageHtml: SHOPIFY_HOME,
    });
    assert.equal(r.platformDetected, 'shopify');
    assert.ok(r.confidence >= 35);
    assert.ok(r.signals.some((s) => s.startsWith('shopify:')));
  });

  it('detecta WooCommerce', () => {
    const r = detectPlatform({
      baseUrl: 'https://woo.example',
      homepageHtml: WOO_HOME,
    });
    assert.equal(r.platformDetected, 'woocommerce');
    assert.ok(r.confidence >= 35);
  });

  it('detecta VTEX', () => {
    const r = detectPlatform({
      baseUrl: 'https://vtex.example',
      homepageHtml: VTEX_HOME,
    });
    assert.equal(r.platformDetected, 'vtex');
    assert.ok(r.confidence >= 35);
  });

  it('detecta Magento', () => {
    const r = detectPlatform({
      baseUrl: 'https://magento.example',
      homepageHtml: MAGENTO_HOME,
    });
    assert.equal(r.platformDetected, 'magento');
    assert.ok(r.confidence >= 35);
  });

  it('detecta Next.js', () => {
    const r = detectPlatform({
      baseUrl: 'https://nextjs.example',
      homepageHtml: NEXTJS_HOME,
    });
    assert.equal(r.platformDetected, 'nextjs');
    assert.ok(r.confidence >= 35);
  });

  it('retorna custom quando não há sinal forte', () => {
    const r = detectPlatform({
      baseUrl: 'https://custom.example',
      homepageHtml: CUSTOM_HOME,
    });
    assert.equal(r.platformDetected, 'custom');
  });

  it('retorna custom quando HTML é vazio', () => {
    const r = detectPlatform({ baseUrl: 'https://x.com', homepageHtml: '' });
    assert.equal(r.platformDetected, 'custom');
    assert.equal(r.confidence, 0);
  });
});

// ─── 2. Search Discoverer ───────────────────────────────────────────────

describe('searchDiscoverer', () => {
  it('encontra searchUrlTemplate via form action + input name=q', () => {
    const r = discoverSearchUrl({
      baseUrl: 'https://lojateste.com.br',
      homepageHtml: CUSTOM_HOME,
    });
    assert.equal(r.method, 'form_detected');
    assert.ok(r.searchUrlTemplate?.includes('/buscar'));
    assert.ok(r.searchUrlTemplate?.includes('q={query}'));
    assert.equal(r.confidence, 70);
  });

  it('usa padrão conhecido da plataforma (shopify)', () => {
    const r = discoverSearchUrl({
      baseUrl: 'https://shop.example',
      platformDetected: 'shopify',
    });
    assert.equal(r.method, 'known_platform');
    assert.ok(r.searchUrlTemplate?.endsWith('/search?q={query}'));
    assert.equal(r.confidence, 80);
  });

  it('plataforma vence formulário quando ambos existem', () => {
    const r = discoverSearchUrl({
      baseUrl: 'https://shop.example',
      homepageHtml: CUSTOM_HOME,
      platformDetected: 'shopify',
    });
    assert.equal(r.method, 'known_platform');
  });

  it('usa search_url_template legado como fallback', () => {
    const r = discoverSearchUrl({
      baseUrl: 'https://lojateste.com.br',
      homepageHtml: HOME_NO_FORM,
      legacyTemplate: 'https://lojateste.com.br/loja?p={q}',
    });
    assert.equal(r.method, 'legacy');
    assert.equal(r.searchUrlTemplate, 'https://lojateste.com.br/loja?p={q}');
    assert.equal(r.confidence, 40);
  });

  it('retorna null quando não há busca detectável', () => {
    const r = discoverSearchUrl({
      baseUrl: 'https://lojateste.com.br',
      homepageHtml: HOME_NO_FORM,
    });
    assert.equal(r.method, 'none');
    assert.equal(r.searchUrlTemplate, null);
    assert.equal(r.confidence, 0);
  });
});

// ─── 3. Product Page Detector ──────────────────────────────────────────

describe('productPageDetector — detectProductCandidates', () => {
  it('extrai candidatos com /produto/, /products/, /dp/, MLB-', () => {
    const r = detectProductCandidates({
      searchPageHtml: SEARCH_PAGE_WITH_CANDIDATES,
      searchPageUrl: 'https://loja.com/busca?q=teste',
      baseUrl: 'https://loja.com',
    });
    assert.ok(r.candidates.length >= 3);
    const urls = r.candidates.map((c) => c.url);
    assert.ok(urls.some((u) => u.includes('/produto/notebook')));
    assert.ok(urls.some((u) => u.includes('/products/teclado')));
    assert.ok(urls.some((u) => u.includes('/dp/B0CXXXXXXX')));
    assert.ok(urls.some((u) => /MLB-?\d{6,}/.test(u)));
  });

  it('rejeita links de categoria / carrinho / login', () => {
    const r = detectProductCandidates({
      searchPageHtml: SEARCH_PAGE_WITH_CANDIDATES,
      searchPageUrl: 'https://loja.com/busca?q=teste',
      baseUrl: 'https://loja.com',
    });
    const urls = r.candidates.map((c) => c.url);
    assert.ok(!urls.some((u) => u.includes('/category/')));
    assert.ok(!urls.some((u) => u.includes('/checkout/')));
    assert.ok(!urls.some((u) => u.includes('/login')));
    assert.ok(!urls.some((u) => u.includes('javascript:')));
  });

  it('ordena candidatos por confiança e limita a 5', () => {
    const r = detectProductCandidates({
      searchPageHtml: SEARCH_PAGE_WITH_CANDIDATES,
      searchPageUrl: 'https://loja.com/busca?q=teste',
      baseUrl: 'https://loja.com',
    });
    for (let i = 1; i < r.candidates.length; i++) {
      assert.ok(r.candidates[i - 1]!.confidence >= r.candidates[i]!.confidence);
    }
    assert.ok(r.candidates.length <= 5);
  });
});

describe('productPageDetector — isLikelyProductPage', () => {
  it('detecta página de produto por JSON-LD Product', () => {
    const r = isLikelyProductPage({
      html: PRODUCT_PAGE_JSON_LD,
      url: 'https://loja.com/p/notebook',
    });
    assert.equal(r.isProductPage, true);
    assert.ok(r.reasons.includes('json_ld_product'));
    assert.ok(r.confidence >= 50);
  });

  it('detecta página de produto por meta product/price', () => {
    const r = isLikelyProductPage({
      html: PRODUCT_PAGE_META,
      url: 'https://loja.com/p/camiseta',
    });
    assert.equal(r.isProductPage, true);
    assert.ok(r.reasons.includes('meta_product_price'));
  });

  it('retorna baixa confiança em páginas genéricas', () => {
    const r = isLikelyProductPage({
      html: PRODUCT_PAGE_GENERIC,
      url: 'https://loja.com/sobre',
    });
    assert.equal(r.isProductPage, false);
    assert.ok(r.confidence < 40);
  });
});

// ─── 4. Extractor Detector ─────────────────────────────────────────────

describe('extractorDetector', () => {
  it('detecta json_ld quando há Product/Offer/price', () => {
    const r = detectExtractionStrategy({
      productPageHtml: PRODUCT_PAGE_JSON_LD,
      productPageUrl: 'https://loja.com/p/notebook',
    });
    assert.equal(r.extractionStrategy, 'json_ld');
    assert.ok(r.confidence >= 80);
    assert.equal(r.jsonLdEnabled, true);
  });

  it('detecta next_data quando há __NEXT_DATA__ sem JSON-LD com preço', () => {
    const r = detectExtractionStrategy({
      productPageHtml: PRODUCT_PAGE_NEXT_DATA,
      productPageUrl: 'https://loja.com/produto/x',
    });
    // next_data ou meta_tags pode bater — ambos são aceitáveis aqui.
    // Como a página tem og:type=product (sem product:price) e __NEXT_DATA__,
    // a estratégia preferida é next_data.
    assert.equal(r.extractionStrategy, 'next_data');
    assert.ok(r.confidence >= 60);
  });

  it('detecta meta_tags quando há product:price:amount + og:type', () => {
    const r = detectExtractionStrategy({
      productPageHtml: PRODUCT_PAGE_META,
      productPageUrl: 'https://loja.com/p/camiseta',
    });
    assert.equal(r.extractionStrategy, 'meta_tags');
    assert.ok(r.confidence >= 60);
  });

  it('detecta dom quando só há preço textual', () => {
    const r = detectExtractionStrategy({
      productPageHtml: PRODUCT_PAGE_DOM_ONLY,
      productPageUrl: 'https://loja.com/produto/cafeteira',
    });
    assert.equal(r.extractionStrategy, 'dom');
    assert.ok(r.confidence > 0 && r.confidence < 70);
  });

  it('retorna null quando não há sinal', () => {
    const r = detectExtractionStrategy({
      productPageHtml: PRODUCT_PAGE_GENERIC,
      productPageUrl: 'https://loja.com/sobre',
    });
    assert.equal(r.extractionStrategy, null);
    assert.equal(r.confidence, 0);
  });
});

// ─── 5. Recipe Builder ─────────────────────────────────────────────────

describe('buildSupplierRecipe', () => {
  it('cria SupplierRecipe com supplierId e status default unconfigured', () => {
    const r = buildSupplierRecipe({
      supplierId: 'sup-1',
      platform: { platformDetected: 'custom', confidence: 0, signals: [] },
      search: {
        searchUrlTemplate: null,
        confidence: 0,
        method: 'none',
        testedPatterns: [],
      },
      productPage: null,
      productCandidates: [],
      extractor: {
        extractionStrategy: null,
        confidence: 0,
        signals: [],
        jsonLdEnabled: false,
        requiresJs: false,
        requiresBrowser: false,
      },
    });
    assert.equal(r.supplierId, 'sup-1');
    assert.equal(r.status, 'unconfigured');
    assert.equal(r.confidence, 0);
  });

  it('agrega confiança das partes detectadas', () => {
    const r = buildSupplierRecipe({
      supplierId: 'sup-1',
      platform: { platformDetected: 'shopify', confidence: 90, signals: [] },
      search: {
        searchUrlTemplate: 'https://x/search?q={query}',
        confidence: 80,
        method: 'known_platform',
        testedPatterns: [],
      },
      productPage: {
        isProductPage: true,
        confidence: 80,
        reasons: ['json_ld_product'],
      },
      productCandidates: [],
      extractor: {
        extractionStrategy: 'json_ld',
        confidence: 90,
        signals: [],
        jsonLdEnabled: true,
        requiresJs: false,
        requiresBrowser: false,
      },
    });
    assert.ok((r.confidence ?? 0) >= 80);
    assert.equal(r.extractionStrategy, 'json_ld');
    assert.equal(r.searchUrlTemplate, 'https://x/search?q={query}');
  });

  it('grava sinais em configJson.autoConfig', () => {
    const r = buildSupplierRecipe({
      supplierId: 'sup-1',
      platform: {
        platformDetected: 'shopify',
        confidence: 90,
        signals: ['shopify:cdn.shopify.com'],
      },
      search: {
        searchUrlTemplate: 'https://x/search?q={query}',
        confidence: 80,
        method: 'known_platform',
        testedPatterns: ['https://x/search?q={query}'],
      },
      productPage: null,
      productCandidates: [],
      extractor: {
        extractionStrategy: null,
        confidence: 0,
        signals: [],
        jsonLdEnabled: false,
      },
    });
    const cfg = r.configJson as Record<string, unknown> | null;
    assert.ok(cfg && typeof cfg === 'object');
    const auto = (cfg as { autoConfig: Record<string, unknown> }).autoConfig;
    assert.deepEqual(auto.platformSignals, ['shopify:cdn.shopify.com']);
    assert.equal(auto.searchMethod, 'known_platform');
  });
});

// ─── 6. Certifier ───────────────────────────────────────────────────────

describe('certifyRecipeCandidate', () => {
  const baseRecipe: SupplierRecipe = {
    supplierId: 'sup-1',
    status: 'unconfigured',
  };

  it('certified quando tudo OK e confidence >= 70', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true,
        searchConfidence: 80,
        hasProductSignal: true,
        productConfidence: 80,
        hasExtractionStrategy: true,
        extractorConfidence: 90,
        blocked: false,
        requiresLogin: false,
      },
    });
    assert.equal(r.status, 'certified');
    assert.ok(r.confidence >= 70);
  });

  it('needs_guided_setup quando confidence < 70 mesmo com tudo presente', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true,
        searchConfidence: 50,
        hasProductSignal: true,
        productConfidence: 50,
        hasExtractionStrategy: true,
        extractorConfidence: 45,
        blocked: false,
        requiresLogin: false,
      },
    });
    assert.equal(r.status, 'needs_guided_setup');
  });

  it('needs_guided_setup quando falta estratégia confiável', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true,
        searchConfidence: 80,
        hasProductSignal: false,
        productConfidence: 0,
        hasExtractionStrategy: false,
        extractorConfidence: 0,
        blocked: false,
        requiresLogin: false,
      },
    });
    assert.equal(r.status, 'needs_guided_setup');
  });

  it('blocked tem precedência sobre tudo', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true,
        searchConfidence: 80,
        hasProductSignal: true,
        productConfidence: 80,
        hasExtractionStrategy: true,
        extractorConfidence: 90,
        blocked: true,
        requiresLogin: false,
      },
    });
    assert.equal(r.status, 'blocked');
    assert.equal(r.confidence, 0);
  });

  it('requires_login tem precedência sobre certified', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true,
        searchConfidence: 80,
        hasProductSignal: true,
        productConfidence: 80,
        hasExtractionStrategy: true,
        extractorConfidence: 90,
        blocked: false,
        requiresLogin: true,
      },
    });
    assert.equal(r.status, 'requires_login');
  });

  it('unsupported quando não há busca, produto nem preço', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: false,
        searchConfidence: 0,
        hasProductSignal: false,
        productConfidence: 0,
        hasExtractionStrategy: false,
        extractorConfidence: 0,
        blocked: false,
        requiresLogin: false,
      },
    });
    assert.equal(r.status, 'unsupported');
  });

  it('failed quando o fetch técnico falhou', () => {
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: false,
        searchConfidence: 0,
        hasProductSignal: false,
        productConfidence: 0,
        hasExtractionStrategy: false,
        extractorConfidence: 0,
        blocked: false,
        requiresLogin: false,
        fetchFailed: true,
      },
    });
    assert.equal(r.status, 'failed');
  });

  it('receita legada (apenas search_url_template) NÃO vira certified', () => {
    // Cenário: o supplier tem template legado mas nada mais foi detectado.
    const r = certifyRecipeCandidate({
      recipe: baseRecipe,
      discovery: {
        hasSearchUrl: true, // veio do legacy
        searchConfidence: 40, // confidence baixa do método 'legacy'
        hasProductSignal: false,
        productConfidence: 0,
        hasExtractionStrategy: false,
        extractorConfidence: 0,
        blocked: false,
        requiresLogin: false,
      },
    });
    assert.notEqual(r.status, 'certified');
    assert.equal(r.status, 'needs_guided_setup');
  });
});

// ─── 7. autoConfigureSupplier (orquestrador) ───────────────────────────

describe('autoConfigureSupplier — caminho feliz com Shopify simulado', () => {
  it('detecta plataforma, descobre busca, encontra produto, certifica', async () => {
    const supplier = makeSupplier({ site: 'shop.example' });
    const store = createMemoryStore(supplier);
    // Ordem importa: padrões mais específicos vêm primeiro; homepage por último.
    const fetcher = createScriptedFetcher([
      [
        /\/dp\//,
        {
          status: 'ok',
          html: PRODUCT_PAGE_JSON_LD,
          finalUrl: 'https://shop.example/dp/B0CXXXXXXX',
        },
      ],
      [
        /MLB-?\d{6,}/,
        {
          status: 'ok',
          html: PRODUCT_PAGE_JSON_LD,
          finalUrl: 'https://produto.mercadolivre.com.br/MLB-1234567890',
        },
      ],
      [
        /\/produto\//,
        {
          status: 'ok',
          html: PRODUCT_PAGE_JSON_LD,
          finalUrl: 'https://shop.example/produto/notebook-15-prata',
        },
      ],
      [
        /\/products\//,
        {
          status: 'ok',
          html: PRODUCT_PAGE_JSON_LD,
          finalUrl: 'https://shop.example/products/teclado',
        },
      ],
      [
        /\/search\?/,
        {
          status: 'ok',
          html: SEARCH_PAGE_WITH_CANDIDATES,
          finalUrl: 'https://shop.example/search?q=teste',
        },
      ],
      [
        /^https?:\/\/shop\.example\/?$/,
        {
          status: 'ok',
          html: SHOPIFY_HOME,
          finalUrl: 'https://shop.example/',
        },
      ],
    ]);

    const result: SupplierAutoConfigResult = await autoConfigureSupplier(
      supplier.id,
      { fetcher, store },
    );

    assert.equal(result.status, 'certified');
    assert.equal(result.platformDetected, 'shopify');
    assert.ok(result.searchUrlTemplate?.includes('/search?q={query}'));
    assert.ok((result.confidence ?? 0) >= 70);
    assert.ok(result.recipe);
    assert.equal(result.recipe?.status, 'certified');
    // Estado salvo
    assert.equal(store.recipe?.status, 'certified');
    assert.ok(
      store.statusUpdates.some((u) => u.status === 'auto_configuring'),
      'deve marcar auto_configuring no início',
    );
    assert.ok(
      store.statusUpdates.some(
        (u) => u.status === 'certified' && u.setAuto === true,
      ),
      'deve marcar certified com setAutoConfiguredAt no final',
    );
  });
});

describe('autoConfigureSupplier — fornecedor bloqueado', () => {
  it('marca como blocked quando homepage retorna captcha/cloudflare', async () => {
    const supplier = makeSupplier({ site: 'blocked.example' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([
      [
        /blocked\.example/,
        {
          status: 'blocked',
          httpStatus: 403,
          html: BLOCKED_HTML,
          finalUrl: 'https://blocked.example/',
        },
      ],
    ]);

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.equal(result.status, 'blocked');
    assert.equal(store.recipe?.status, 'blocked');
  });
});

describe('autoConfigureSupplier — fornecedor exige login', () => {
  it('marca como requires_login quando homepage retorna 401/login text', async () => {
    const supplier = makeSupplier({ site: 'login.example' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([
      [
        /login\.example/,
        {
          status: 'requires_login',
          httpStatus: 401,
          html: '<html><body>Please sign in</body></html>',
          finalUrl: 'https://login.example/',
        },
      ],
    ]);

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.equal(result.status, 'requires_login');
  });
});

describe('autoConfigureSupplier — fetch falho da homepage', () => {
  it('marca como failed quando fetcher retorna error', async () => {
    const supplier = makeSupplier({ site: 'erro.example' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([
      [
        /erro\.example/,
        {
          status: 'error',
          error: 'ECONNRESET',
        },
      ],
    ]);

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
  });
});

describe('autoConfigureSupplier — sem busca, sem produto', () => {
  it('marca como unsupported quando homepage é genérica', async () => {
    const supplier = makeSupplier({ site: 'sem.example' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([
      [
        /sem\.example/,
        {
          status: 'ok',
          html: HOME_NO_FORM,
          finalUrl: 'https://sem.example/',
        },
      ],
    ]);

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.equal(result.status, 'unsupported');
  });
});

describe('autoConfigureSupplier — sinais parciais', () => {
  it('marca needs_guided_setup quando só descobre busca por form mas não detecta produto', async () => {
    const supplier = makeSupplier({ site: 'parcial.example' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher(
      [
        [
          /parcial\.example\/buscar/,
          {
            status: 'ok',
            html: '<html><body>nenhum produto</body></html>',
            finalUrl: 'https://parcial.example/buscar?q=teste',
          },
        ],
        [
          /^https?:\/\/parcial\.example\/?$/,
          {
            status: 'ok',
            html: CUSTOM_HOME,
            finalUrl: 'https://parcial.example/',
          },
        ],
      ],
      { status: 'ok', html: '' },
    );

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.equal(result.status, 'needs_guided_setup');
    assert.equal(store.recipe?.status, 'needs_guided_setup');
  });
});

describe('autoConfigureSupplier — supplier inexistente', () => {
  it('propaga erro quando getSupplier rejeita', async () => {
    const supplier = makeSupplier({ id: 'sup-existente' });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([]);

    await assert.rejects(
      () => autoConfigureSupplier('sup-inexistente', { fetcher, store }),
      /n[ãa]o encontrado/i,
    );
    // Não deve ter chamado nenhum fetch (falhou antes)
    assert.equal(fetcher.calls.length, 0);
  });
});

describe('autoConfigureSupplier — receita legada não vira certified sozinha', () => {
  it('supplier com search_url_template antigo + homepage vazia → needs_guided_setup', async () => {
    const supplier = makeSupplier({
      site: 'legado.example',
      search_url_template: 'https://legado.example/loja?p={q}',
    });
    const store = createMemoryStore(supplier);
    const fetcher = createScriptedFetcher([
      [
        /legado\.example\/loja/,
        {
          status: 'ok',
          html: '<html><body>SERP sem produtos detectáveis</body></html>',
        },
      ],
      [
        /^https?:\/\/legado\.example\/?$/,
        {
          status: 'ok',
          html: HOME_NO_FORM,
        },
      ],
    ]);

    const result = await autoConfigureSupplier(supplier.id, { fetcher, store });
    assert.notEqual(result.status, 'certified');
    // Como o template legado vira searchUrl com confidence baixa, ainda
    // assim entra em needs_guided_setup (não unsupported).
    assert.equal(result.status, 'needs_guided_setup');
  });
});

/**
 * Testes do localProductExtractor — orquestrador local de extração de produto.
 *
 * Cobre os 13 cenários do spec da Etapa 4 sem usar internet, DB ou IA.
 * Todos os fixtures são HTML/markdown sintéticos inline.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { extractLocalProduct } = await import(
  '../suppliers/v2/extractors/localProductExtractor.js'
);

type LocalExtractionInput =
  import('../suppliers/v2/extractors/localProductExtractor.js').LocalExtractionInput;
type Supplier = import('../services/supplierService.js').Supplier;

// ─── Supplier fake ───────────────────────────────────────────────────────────

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Loja Teste',
    site: 'https://loja.test',
    currency: 'BRL',
    country: 'BR',
    active: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Supplier;
}

// ─── HTML fixtures ───────────────────────────────────────────────────────────

const JSON_LD_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Notebook Dell Inspiron 15 i5 16GB",
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
</body></html>`;

const META_TAGS_PAGE = `
<html><head>
<meta property="og:type" content="product">
<meta property="og:title" content="Smartphone Samsung Galaxy A15 128GB">
<meta property="product:price:amount" content="1399.90">
<meta property="product:price:currency" content="BRL">
</head><body>
<h1>Samsung Galaxy A15 128GB</h1>
<span class="price">R$ 1.399,90</span>
</body></html>`;

const NEXT_DATA_PAGE = `
<html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "product": {
        "title": "Monitor LG UltraWide 29 Polegadas",
        "price": 1899.00,
        "currency": "BRL"
      }
    }
  }
}
</script>
<h1>Monitor LG UltraWide 29"</h1>
</body></html>`;

const DOM_ONLY_PAGE = `
<html><head>
<title>Cadeira Gamer Thunder X3 Preta - Loja Teste</title>
</head><body>
<h1>Cadeira Gamer Thunder X3 Preta</h1>
<span class="price">R$ 899,90 à vista</span>
<p>Produto disponível para entrega imediata</p>
</body></html>`;

const FREE_SHIPPING_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Tablet Samsung Galaxy Tab A7",
  "offers": {
    "@type": "Offer",
    "price": "1299.00",
    "priceCurrency": "BRL"
  }
}
</script>
</head><body>
<h1>Tablet Samsung Galaxy Tab A7</h1>
<p class="price">R$ 1.299,00</p>
<p class="shipping">Frete Grátis para todo o Brasil!</p>
</body></html>`;

const PAID_SHIPPING_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Teclado Mecânico Redragon Kumara",
  "offers": {
    "@type": "Offer",
    "price": "249.90",
    "priceCurrency": "BRL"
  }
}
</script>
</head><body>
<h1>Teclado Mecânico Redragon Kumara</h1>
<p>R$ 249,90</p>
<p>Frete R$ 19,90 para sua região</p>
</body></html>`;

const OUT_OF_STOCK_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "PlayStation 5 Sony",
  "offers": {
    "@type": "Offer",
    "price": "3999.00",
    "priceCurrency": "BRL"
  }
}
</script>
</head><body>
<h1>PlayStation 5 Sony</h1>
<p>R$ 3.999,00</p>
<p class="stock-status">Produto Esgotado</p>
</body></html>`;

const NO_PRICE_PAGE = `
<html><head></head><body>
<h1>Impressora HP LaserJet Pro M404</h1>
<p>Confira mais detalhes do produto</p>
<p>Disponível somente em lojas físicas</p>
</body></html>`;

const ACCESSORY_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Cabo USB-C para Notebook Dell",
  "offers": {
    "@type": "Offer",
    "price": "49.90",
    "priceCurrency": "BRL"
  }
}
</script>
</head><body>
<h1>Cabo USB-C para Notebook Dell</h1>
<p>R$ 49,90</p>
</body></html>`;

const MARKDOWN_PRODUCT = `
# Samsung Galaxy A15 128GB

Memória: 128GB | RAM: 4GB
Cor: Azul Claro

**Preço: R$ 1.399,90**

Frete Grátis

Disponível em estoque
`;

// ─── URLs ────────────────────────────────────────────────────────────────────

const PRODUCT_URL = 'https://loja.test/produtos/notebook-dell-inspiron-15';
const PRODUCT_URL_DP = 'https://amazon.com/dp/B09ABCDE12';
const SEARCH_URL = 'https://loja.test/busca?q=notebook';
const CART_URL = 'https://loja.test/carrinho';
const HOME_URL = 'https://loja.test/';
const UNKNOWN_URL = 'https://loja.test/blog/novidades';

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('extractLocalProduct', () => {
  // 1. JSON-LD
  it('extrai produto via JSON-LD e retorna validated', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'notebook dell inspiron 15',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.found, true);
    assert.ok(r.productName?.toLowerCase().includes('notebook'));
    assert.ok(typeof r.price === 'number' && r.price > 0);
    assert.equal(r.currency, 'BRL');
    assert.equal(r.linkValidated, true);
    assert.equal(r.linkType, 'product');
    assert.ok(r.evidence?.evidenceText);
  });

  // 2. Meta tags
  it('extrai produto via meta tags og/product e retorna validated', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/samsung-galaxy-a15',
      supplier: makeSupplier(),
      query: 'samsung galaxy a15 128gb',
      html: META_TAGS_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.ok(r.productName?.toLowerCase().includes('samsung'));
    assert.ok(typeof r.price === 'number' && r.price > 0);
  });

  // 3. __NEXT_DATA__
  it('extrai produto via __NEXT_DATA__ e retorna validated', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/monitor-lg-ultrawide',
      supplier: makeSupplier(),
      query: 'monitor lg ultrawide 29',
      html: NEXT_DATA_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.ok(r.productName?.toLowerCase().includes('monitor'));
  });

  // 4. DOM fallback
  it('extrai produto via DOM (h1 + ranker de preço) quando sem JSON-LD', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'cadeira gamer thunder x3',
      html: DOM_ONLY_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.ok(r.productName?.toLowerCase().includes('cadeira'));
    assert.ok(typeof r.price === 'number' && r.price > 0);
  });

  // 5. Markdown
  it('extrai produto de markdown quando sem HTML', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/samsung-galaxy-a15',
      supplier: makeSupplier(),
      query: 'samsung galaxy a15 128gb',
      markdown: MARKDOWN_PRODUCT,
    });
    assert.equal(r.status, 'validated');
    assert.ok(r.productName?.toLowerCase().includes('samsung'));
    assert.ok(typeof r.price === 'number' && r.price > 0);
  });

  // 6. Produto sem preço → price_not_found
  it('retorna price_not_found quando produto tem nome mas sem preço', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'impressora hp laserjet',
      html: NO_PRICE_PAGE,
    });
    assert.equal(r.status, 'price_not_found');
    assert.equal(r.found, false);
  });

  // 7. Product mismatch — score baixo
  it('retorna product_mismatch quando query não corresponde ao produto', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'televisão samsung 55 polegadas',
      html: JSON_LD_PAGE, // produto = notebook dell
    });
    assert.equal(r.status, 'product_mismatch');
    assert.equal(r.found, false);
  });

  // 8. Produto acessório → product_mismatch
  it('retorna product_mismatch quando produto parece acessório para query de produto principal', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'notebook dell inspiron',
      html: ACCESSORY_PAGE, // produto = cabo USB-C para notebook dell
    });
    assert.equal(r.status, 'product_mismatch');
  });

  // 9. URL de busca → invalid_link
  it('retorna invalid_link para URL de busca', () => {
    const r = extractLocalProduct({
      url: SEARCH_URL,
      supplier: makeSupplier(),
      query: 'notebook',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'invalid_link');
    assert.equal(r.found, false);
  });

  // 10. URL de carrinho → invalid_link
  it('retorna invalid_link para URL de carrinho', () => {
    const r = extractLocalProduct({
      url: CART_URL,
      supplier: makeSupplier(),
      query: 'notebook',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'invalid_link');
  });

  // 11. Homepage → invalid_link
  it('retorna invalid_link para homepage', () => {
    const r = extractLocalProduct({
      url: HOME_URL,
      supplier: makeSupplier(),
      query: 'notebook',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'invalid_link');
  });

  // 12. URL sem padrão de produto → invalid_link
  it('retorna invalid_link quando URL não tem padrão reconhecível de produto', () => {
    const r = extractLocalProduct({
      url: UNKNOWN_URL,
      supplier: makeSupplier(),
      query: 'notebook dell',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'invalid_link');
  });

  // 13. Sem conteúdo → not_found
  it('retorna not_found quando sem html e sem markdown', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'notebook',
    });
    assert.equal(r.status, 'not_found');
    assert.equal(r.found, false);
  });

  // 14. Frete grátis confirmado
  it('captura freightStatus=free_confirmed quando página tem "frete grátis"', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/tablet-samsung-tab-a7',
      supplier: makeSupplier(),
      query: 'tablet samsung galaxy tab a7',
      html: FREE_SHIPPING_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.freightStatus, 'free_confirmed');
    assert.equal(r.freight, 0);
  });

  // 15. Frete pago confirmado
  it('captura freightStatus=confirmed com valor quando página tem frete rotulado', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'teclado mecânico redragon kumara',
      html: PAID_SHIPPING_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.freightStatus, 'confirmed');
    assert.ok(typeof r.freight === 'number' && r.freight > 0);
  });

  // 16. Produto esgotado → validated mas available=false
  it('detecta produto esgotado e retorna available=false', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/playstation-5',
      supplier: makeSupplier(),
      query: 'playstation 5 sony',
      html: OUT_OF_STOCK_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.available, false);
  });

  // 17. URL dp/ (Amazon) é reconhecida como produto
  it('aceita URL com padrão /dp/ como produto válido', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL_DP,
      supplier: makeSupplier(),
      query: 'notebook dell inspiron 15',
      html: JSON_LD_PAGE,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.linkValidated, true);
  });

  // 18. Sem HTML mas com markdown — frete grátis via markdown
  it('extrai frete grátis a partir de markdown', () => {
    const r = extractLocalProduct({
      url: 'https://loja.test/produtos/samsung-galaxy-a15',
      supplier: makeSupplier(),
      query: 'samsung galaxy a15 128gb',
      markdown: MARKDOWN_PRODUCT,
    });
    assert.equal(r.status, 'validated');
    assert.equal(r.freightStatus, 'free_confirmed');
  });

  // 19. minMatchScore customizado
  it('respeita minMatchScore customizado (20) e aceita match parcial', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'dell inspiron',
      html: JSON_LD_PAGE,
      minMatchScore: 20,
    });
    // Com threshold baixo, query "dell inspiron" deve aceitar "Notebook Dell Inspiron 15"
    assert.equal(r.status, 'validated');
  });

  // 20. preferredStrategy sobrepõe a ordem padrão
  it('usa estratégia preferida primeiro (json_ld → deve funcionar mesmo com preferred=dom)', () => {
    const r = extractLocalProduct({
      url: PRODUCT_URL,
      supplier: makeSupplier(),
      query: 'notebook dell inspiron 15',
      html: JSON_LD_PAGE,
      preferredStrategy: 'dom',
    });
    // Mesmo com preferredStrategy=dom, a cascata deve eventualmente usar json_ld como fallback
    // OU dom encontra o produto via h1+preço. De qualquer forma, resultado deve ser validated.
    assert.equal(r.status, 'validated');
  });
});

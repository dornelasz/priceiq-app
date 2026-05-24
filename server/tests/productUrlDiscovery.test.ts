/**
 * Etapa 6 — descoberta própria de URLs de produto.
 *
 * Cobre os contratos e helpers SEM rede, sem DB, sem IA:
 *  - buildDiscoverySearchUrl seleciona template correto e encoda query
 *  - extractUrls normaliza hrefs relativos, remove tracking, deduplica,
 *    rejeita login/cart/checkout/home
 *  - rankCandidates mantém só product/unknown; search não entra nos candidatos
 *  - scoreCandidateUrl pontua product > category; tokens da query dão bônus
 *  - discoverProductUrls retorna status, candidates e diagnostics coerentes
 *  - tokenizeQuery parte query em tokens normalizados
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildDiscoverySearchUrl,
  extractUrls,
  normalizeCandidateUrl,
  removeTrackingParams,
  getSupplierDomain,
  rankCandidates,
  scoreCandidateUrl,
  tokenizeQuery,
  discoverProductUrls,
} = await import('../suppliers/v2/searchEngine/index.js');

type Supplier = import('../services/supplierService.js').Supplier;

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Loja Teste',
    site: 'https://loja.test',
    currency: 'BRL',
    country: 'BR',
    active: true,
    search_url_template: '',
    type: 'store',
    extraction_mode: 'auto',
    extractor_config: {},
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as Supplier;
}

// ── buildDiscoverySearchUrl ───────────────────────────────────────────────

describe('buildDiscoverySearchUrl', () => {
  it('usa recipe.searchUrlTemplate quando disponível', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const recipe = { supplierId: 's1', status: 'certified' as const, searchUrlTemplate: 'https://loja.test/pesquisa?termo={q}' };
    const { url, source } = buildDiscoverySearchUrl({ supplier: s, recipe, query: 'notebook' });
    assert.equal(url, 'https://loja.test/pesquisa?termo=notebook');
    assert.equal(source, 'recipe_template');
  });

  it('usa legacy search_url_template quando não há recipe template', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const { url, source } = buildDiscoverySearchUrl({ supplier: s, query: 'notebook' });
    assert.equal(url, 'https://loja.test/busca?q=notebook');
    assert.equal(source, 'legacy_template');
  });

  it('encoda query com espaços e caracteres especiais', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/s?q={q}' });
    const { url } = buildDiscoverySearchUrl({ supplier: s, query: 'notebook dell i7 16GB' });
    assert.equal(url, 'https://loja.test/s?q=notebook%20dell%20i7%2016GB');
  });

  it('encoda caracteres acentuados', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/s?q={q}' });
    const { url } = buildDiscoverySearchUrl({ supplier: s, query: 'câmera & açaí' });
    assert.ok(url.includes('loja.test'), 'deve manter domínio do fornecedor');
    assert.ok(!url.includes(' '), 'espaços devem ser encodados');
  });

  it('usa fallback /search?q= quando sem template', () => {
    const s = makeSupplier({ search_url_template: '' });
    const { url, source, isFallback } = buildDiscoverySearchUrl({ supplier: s, query: 'notebook' });
    assert.ok(url.includes('/search?q=notebook'));
    assert.equal(source, 'fallback');
    assert.equal(isFallback, true);
  });

  it('fallback nunca gera URL de produto', () => {
    const s = makeSupplier({ search_url_template: '' });
    const { url } = buildDiscoverySearchUrl({ supplier: s, query: 'iphone 15' });
    assert.ok(!/\/(p|dp|product|produto|item)\//i.test(url), `fallback não pode ter rota de produto: ${url}`);
  });
});

// ── normalizeCandidateUrl ─────────────────────────────────────────────────

describe('normalizeCandidateUrl', () => {
  it('converte href relativo em absoluto', () => {
    const result = normalizeCandidateUrl('/produtos/notebook-dell', 'https://loja.test/busca');
    assert.equal(result, 'https://loja.test/produtos/notebook-dell');
  });

  it('preserva URL absoluta como está', () => {
    const result = normalizeCandidateUrl('https://loja.test/p/abc', 'https://loja.test/');
    assert.equal(result, 'https://loja.test/p/abc');
  });

  it('retorna null para javascript:', () => {
    assert.equal(normalizeCandidateUrl('javascript:void(0)', 'https://loja.test'), null);
  });

  it('retorna null para href vazio', () => {
    assert.equal(normalizeCandidateUrl('', 'https://loja.test'), null);
  });

  it('retorna null para fragmentos #', () => {
    assert.equal(normalizeCandidateUrl('#section', 'https://loja.test'), null);
  });
});

// ── removeTrackingParams ──────────────────────────────────────────────────

describe('removeTrackingParams', () => {
  it('remove utm_source', () => {
    const url = 'https://loja.test/p/abc?utm_source=google&id=123';
    const cleaned = removeTrackingParams(url);
    assert.ok(!cleaned.includes('utm_source'), 'utm_source deve ser removido');
    assert.ok(cleaned.includes('id=123'), 'outros params devem ser preservados');
  });

  it('remove utm_medium, utm_campaign, fbclid, gclid', () => {
    const url = 'https://loja.test/p/abc?utm_medium=cpc&utm_campaign=sale&fbclid=xxx&gclid=yyy&ref=home';
    const cleaned = removeTrackingParams(url);
    assert.ok(!cleaned.includes('utm_medium'));
    assert.ok(!cleaned.includes('utm_campaign'));
    assert.ok(!cleaned.includes('fbclid'));
    assert.ok(!cleaned.includes('gclid'));
  });

  it('preserva URL sem tracking params intocada', () => {
    const url = 'https://loja.test/produtos/notebook?sku=123&cor=preto';
    assert.equal(removeTrackingParams(url), url);
  });
});

// ── extractUrls ───────────────────────────────────────────────────────────

describe('extractUrls', () => {
  it('extrai href relativo e converte para absoluto', () => {
    const html = '<a href="/produtos/notebook-dell">Notebook Dell</a>';
    const { urls } = extractUrls({ html, baseUrl: 'https://loja.test/busca' });
    assert.equal(urls.length, 1);
    assert.equal(urls[0]!.url, 'https://loja.test/produtos/notebook-dell');
    assert.equal(urls[0]!.source, 'href');
  });

  it('remove tracking params dos hrefs', () => {
    const html = '<a href="/p/abc?utm_source=google&utm_campaign=sale">Produto</a>';
    const { urls } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.ok(!urls[0]?.url.includes('utm_source'), 'tracking param deve ser removido');
    assert.ok(urls[0]?.url.includes('/p/abc'), 'path deve ser mantido');
  });

  it('deduplica links idênticos após normalização', () => {
    const html = `
      <a href="/p/abc">Item 1</a>
      <a href="/p/abc">Item 2</a>
      <a href="https://loja.test/p/abc">Item 3</a>
    `;
    const { urls, rejectionReasons } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.equal(urls.length, 1);
    assert.ok((rejectionReasons['duplicate'] ?? 0) >= 2, 'duplicatas devem ser registradas');
  });

  it('rejeita links de login', () => {
    const html = `
      <a href="/login">Entrar</a>
      <a href="/signin">Sign in</a>
      <a href="/entrar">Entrar</a>
    `;
    const { urls, rejectionReasons } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.equal(urls.length, 0);
    assert.ok((rejectionReasons['login'] ?? 0) >= 3, 'login deve ser registrado como rejeitado');
  });

  it('rejeita links de carrinho e checkout', () => {
    const html = `
      <a href="/cart">Carrinho</a>
      <a href="/carrinho">Carrinho</a>
      <a href="/checkout/step1">Checkout</a>
    `;
    const { urls, rejectionReasons } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.equal(urls.length, 0);
    assert.ok((rejectionReasons['cart'] ?? 0) >= 2, 'cart deve ser registrado');
    assert.ok((rejectionReasons['checkout'] ?? 0) >= 1, 'checkout deve ser registrado');
  });

  it('rejeita homepage (path vazio ou /)', () => {
    const html = `
      <a href="https://loja.test/">Home</a>
      <a href="https://loja.test">Home 2</a>
    `;
    const { urls, rejectionReasons } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.equal(urls.length, 0);
    assert.ok((rejectionReasons['home'] ?? 0) >= 1, 'home deve ser registrado');
  });

  it('extrai canonical', () => {
    const html = '<link rel="canonical" href="https://loja.test/p/notebook-dell-xyz" />';
    const { urls } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.ok(urls.some((u) => u.source === 'canonical' && u.url.includes('/p/notebook-dell-xyz')));
  });

  it('extrai og:url', () => {
    const html = '<meta property="og:url" content="https://loja.test/produtos/mouse-logitech" />';
    const { urls } = extractUrls({ html, baseUrl: 'https://loja.test' });
    assert.ok(urls.some((u) => u.source === 'og_url' && u.url.includes('mouse-logitech')));
  });

  it('registra motivos de rejeição nos rejectionReasons', () => {
    const html = `
      <a href="/login">Login</a>
      <a href="/cart">Cart</a>
      <a href="/checkout">Checkout</a>
    `;
    const { rejectionReasons } = extractUrls({ html, baseUrl: 'https://loja.test' });
    const total = Object.values(rejectionReasons).reduce((a, b) => a + b, 0);
    assert.ok(total >= 3, `deve registrar pelo menos 3 rejeições, got ${total}`);
  });
});

// ── tokenizeQuery ─────────────────────────────────────────────────────────

describe('tokenizeQuery', () => {
  it('divide query em tokens lowercase', () => {
    const tokens = tokenizeQuery('Notebook Dell i7');
    assert.ok(tokens.includes('notebook'));
    assert.ok(tokens.includes('dell'));
    assert.ok(tokens.includes('i7'));
  });

  it('remove diacríticos dos tokens', () => {
    const tokens = tokenizeQuery('câmera ação');
    assert.ok(tokens.includes('camera') || tokens.includes('camara'), `tokens: ${tokens.join(',')}`);
  });

  it('filtra tokens com menos de 2 chars', () => {
    const tokens = tokenizeQuery('a b cd ef');
    assert.ok(!tokens.includes('a'));
    assert.ok(!tokens.includes('b'));
    assert.ok(tokens.includes('cd'));
    assert.ok(tokens.includes('ef'));
  });
});

// ── scoreCandidateUrl ─────────────────────────────────────────────────────

describe('scoreCandidateUrl', () => {
  it('produto recebe score maior que categoria', () => {
    const product = scoreCandidateUrl('https://loja.test/produtos/notebook-dell', 'notebook');
    const category = scoreCandidateUrl('https://loja.test/category/informatica', 'notebook');
    assert.ok(product.score > category.score, `product(${product.score}) deve ser > category(${category.score})`);
  });

  it('URL com tokens da query recebe score maior que URL genérica', () => {
    const withTokens = scoreCandidateUrl('https://loja.test/p/notebook-samsung', 'notebook samsung');
    const generic = scoreCandidateUrl('https://loja.test/p/xyz-123', 'notebook samsung');
    assert.ok(
      withTokens.score > generic.score,
      `URL com tokens(${withTokens.score}) deve ser > genérica(${generic.score})`,
    );
  });

  it('URL do mesmo domínio recebe bônus', () => {
    const sameDomain = scoreCandidateUrl('https://loja.test/p/abc', 'tv', 'loja.test');
    const diffDomain = scoreCandidateUrl('https://outro.com/p/abc', 'tv', 'loja.test');
    assert.ok(sameDomain.score > diffDomain.score, 'mesmo domínio deve ter score maior');
  });

  it('classifica search como tipo search', () => {
    const result = scoreCandidateUrl('https://loja.test/search?q=notebook', 'notebook');
    assert.equal(result.linkClass, 'search');
  });
});

// ── rankCandidates ────────────────────────────────────────────────────────

describe('rankCandidates', () => {
  it('produto entra nos candidatos, search não entra', () => {
    const urls = [
      { url: 'https://loja.test/search?q=notebook', source: 'href' as const },
      { url: 'https://loja.test/produtos/notebook-dell', source: 'href' as const },
    ];
    const ranked = rankCandidates(urls, 'notebook');
    assert.ok(ranked.some((c) => c.url.includes('/produtos/notebook-dell')));
    assert.ok(!ranked.some((c) => c.url.includes('/search')), 'página de busca não deve entrar nos candidatos');
  });

  it('ordena por score decrescente', () => {
    const urls = [
      { url: 'https://loja.test/p/xyz', source: 'href' as const },
      { url: 'https://loja.test/produtos/notebook-dell', source: 'href' as const },
    ];
    const ranked = rankCandidates(urls, 'notebook dell');
    if (ranked.length >= 2) {
      assert.ok(ranked[0]!.score >= ranked[1]!.score, 'candidatos devem ser ordenados por score');
    }
  });

  it('category não entra nos candidatos finais', () => {
    const urls = [
      { url: 'https://loja.test/category/notebooks', source: 'href' as const },
      { url: 'https://loja.test/categoria/informatica', source: 'href' as const },
    ];
    const ranked = rankCandidates(urls, 'notebook');
    assert.equal(ranked.length, 0, 'categorias não devem entrar nos candidatos');
  });

  it('respeita maxCandidates', () => {
    const urls = Array.from({ length: 20 }, (_, i) => ({
      url: `https://loja.test/produtos/item-${i}`,
      source: 'href' as const,
    }));
    const ranked = rankCandidates(urls, 'item', undefined, 5);
    assert.ok(ranked.length <= 5);
  });
});

// ── discoverProductUrls ───────────────────────────────────────────────────

describe('discoverProductUrls', () => {
  it('retorna candidates_found com URLs de produto', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const html = `
      <a href="/produtos/notebook-dell-i7">Notebook Dell i7</a>
      <a href="/produtos/notebook-samsung">Notebook Samsung</a>
    `;
    const result = discoverProductUrls({
      supplier: s,
      query: 'notebook',
      searchPageHtml: html,
      searchPageUrl: 'https://loja.test/busca?q=notebook',
    });
    assert.equal(result.status, 'candidates_found');
    assert.ok(result.candidates.length > 0, 'deve ter candidatos');
    assert.ok(result.searchUrl?.includes('loja.test'));
  });

  it('retorna no_candidates quando só há links de login/cart/checkout', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const html = `
      <a href="/login">Login</a>
      <a href="/cart">Carrinho</a>
      <a href="/checkout">Checkout</a>
    `;
    const result = discoverProductUrls({
      supplier: s,
      query: 'notebook',
      searchPageHtml: html,
      searchPageUrl: 'https://loja.test/busca?q=notebook',
    });
    assert.equal(result.status, 'no_candidates');
    assert.equal(result.candidates.length, 0);
  });

  it('retorna no_candidates quando não há HTML fornecido', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const result = discoverProductUrls({ supplier: s, query: 'notebook' });
    assert.equal(result.status, 'no_candidates');
    assert.ok(result.searchUrl !== null, 'searchUrl deve ser gerado mesmo sem HTML');
  });

  it('diagnostics registram links extraídos e motivos de rejeição', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const html = `
      <a href="/produtos/notebook-dell">Notebook</a>
      <a href="/login">Login</a>
      <a href="/cart">Cart</a>
    `;
    const result = discoverProductUrls({
      supplier: s,
      query: 'notebook',
      searchPageHtml: html,
      searchPageUrl: 'https://loja.test/busca?q=notebook',
    });
    assert.ok(result.diagnostics.linksExtracted >= 1, 'deve registrar links extraídos');
    assert.ok(result.diagnostics.linksRejected >= 2, 'deve registrar links rejeitados');
    const reasons = result.diagnostics.rejectionReasons;
    assert.ok(Object.keys(reasons).length > 0, 'deve ter motivos de rejeição');
  });

  it('attempts registram cada passo com SearchAttempt da Etapa 5', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const result = discoverProductUrls({
      supplier: s,
      query: 'notebook',
      searchPageHtml: '<a href="/produtos/item">Item</a>',
      searchPageUrl: 'https://loja.test/busca',
    });
    assert.ok(result.attempts.length >= 2, 'deve ter pelo menos 2 attempts');
    assert.ok(result.attempts.every((a) => a.at && a.step && a.status));
  });

  it('não aceita página de busca como candidato final', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const html = `
      <a href="/search?q=notebook">Ver mais resultados</a>
      <a href="/busca?q=notebook">Buscar</a>
      <a href="/produtos/notebook-dell">Notebook Dell</a>
    `;
    const result = discoverProductUrls({
      supplier: s,
      query: 'notebook',
      searchPageHtml: html,
      searchPageUrl: 'https://loja.test/busca?q=notebook',
    });
    const allUrls = result.candidates.map((c) => c.url);
    assert.ok(
      !allUrls.some((u) => /\/(search|busca)\?/i.test(u)),
      `página de busca não deve entrar nos candidatos: ${allUrls.join(', ')}`,
    );
  });

  it('topCandidates em diagnostics contém até 5 entradas', () => {
    const s = makeSupplier({ search_url_template: 'https://loja.test/busca?q={q}' });
    const links = Array.from({ length: 10 }, (_, i) => `<a href="/produtos/item-${i}">Item ${i}</a>`).join('\n');
    const result = discoverProductUrls({
      supplier: s,
      query: 'item',
      searchPageHtml: links,
      searchPageUrl: 'https://loja.test/busca',
    });
    assert.ok(result.diagnostics.topCandidates.length <= 5, 'topCandidates deve ter no máximo 5 entradas');
  });
});

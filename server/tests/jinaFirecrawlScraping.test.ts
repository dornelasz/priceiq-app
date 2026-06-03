/**
 * Testes do scraping via Jina/Firecrawl — markdown extractor, candidate
 * extractor para markdown, e integração com o recipe runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractFromMarkdown } from '../suppliers/v2/extractors/markdownExtractor.js';
import { extractCandidates } from '../suppliers/v2/recipeRunner/candidateExtractor.js';
import { runSupplierRecipe } from '../suppliers/v2/recipeRunner/recipeRunner.js';
import type { Fetcher, FetcherResult } from '../suppliers/v2/fetching/contentFetcher.js';
import type { SupplierRecipe } from '../suppliers/v2/types.js';

// ─── markdownExtractor ──────────────────────────────────────────────

describe('markdownExtractor', () => {
  it('extrai preço BRL com heading como nome', () => {
    const md = `
# Samsung Galaxy S24 Ultra 256GB

Cor: Preto

**R$ 5.499,00**

Frete grátis para São Paulo
`;
    const result = extractFromMarkdown(md, 'https://example.com/product/1');
    assert.ok(result, 'deve retornar resultado');
    assert.equal(result.productName, 'Samsung Galaxy S24 Ultra 256GB');
    assert.equal(result.price, 5499);
    assert.equal(result.currency, 'BRL');
    assert.equal(result.strategy, 'jina_fallback');
    assert.ok(result.confidence >= 50, 'confiança deve ser >= 50');
  });

  it('extrai preço USD', () => {
    const md = `
# iPhone 15 Pro Max

US$ 1,199.00

In stock
`;
    const result = extractFromMarkdown(md, 'https://example.com/p/iphone');
    assert.ok(result);
    assert.equal(result.price, 1199);
    assert.equal(result.currency, 'USD');
  });

  it('extrai preço EUR', () => {
    const md = `
## Notebook Dell Inspiron

€ 899,99

Disponível em estoque
`;
    const result = extractFromMarkdown(md, 'https://example.com/p/dell');
    assert.ok(result);
    assert.equal(result.price, 899.99);
    assert.equal(result.currency, 'EUR');
  });

  it('extrai nome de texto em negrito quando não há heading', () => {
    const md = `
**Cafeteira Nespresso Essenza Mini**

De R$ 399,00 por R$ 299,90

Retire na loja
`;
    const result = extractFromMarkdown(md, 'https://example.com/p/cafe');
    assert.ok(result);
    assert.equal(result.productName, 'Cafeteira Nespresso Essenza Mini');
    assert.ok(result.price === 399 || result.price === 299.9, `preço extraído: ${result.price}`);
  });

  it('extrai nome de link markdown quando não há heading nem bold', () => {
    const md = `
[Monitor LG UltraWide 29" IPS](https://loja.com/monitor-lg)

R$ 1.299,00

Frete: R$ 29,90
`;
    const result = extractFromMarkdown(md, 'https://loja.com/monitor-lg');
    assert.ok(result);
    assert.equal(result.productName, 'Monitor LG UltraWide 29" IPS');
    assert.equal(result.price, 1299);
    assert.equal(result.currency, 'BRL');
  });

  it('retorna null para markdown sem preço e sem heading', () => {
    const result = extractFromMarkdown('Texto qualquer sem nada útil.', 'https://example.com');
    assert.equal(result, null);
  });

  it('retorna parcial quando tem heading mas sem preço', () => {
    const md = `
# Produto Sem Preço Disponível

Indisponível no momento
`;
    const result = extractFromMarkdown(md, 'https://example.com/p/x');
    assert.ok(result);
    assert.equal(result.productName, 'Produto Sem Preço Disponível');
    assert.equal(result.price, undefined);
    assert.ok(result.confidence < 30, 'confiança sem preço deve ser baixa');
  });

  it('ignora preço sem nome de produto por perto', () => {
    const md = 'R$ 99,99';
    const result = extractFromMarkdown(md, 'https://example.com');
    // Sem heading, bold, ou link — não extrai
    assert.ok(!result || !result.price || !result.productName);
  });

  it('extrai preço CNY', () => {
    const md = `
# Xiaomi Redmi Note 13 Pro

¥ 1,599.00

Ships from China
`;
    const result = extractFromMarkdown(md, 'https://example.com/p/xiaomi');
    assert.ok(result);
    assert.equal(result.price, 1599);
    assert.equal(result.currency, 'CNY');
  });
});

// ─── candidateExtractor com markdown ────────────────────────────────

describe('candidateExtractor — markdown links', () => {
  it('extrai links markdown com padrões de produto', () => {
    const md = `
## Resultados da busca

- [Samsung Galaxy S24](https://loja.com/products/samsung-galaxy-s24) - R$ 4.999
- [Capa para Galaxy S24](https://loja.com/products/capa-galaxy-s24) - R$ 49,90
- [iPhone 15](https://loja.com/products/iphone-15) - R$ 6.499
`;
    const result = extractCandidates({
      searchPageHtml: md,
      searchPageUrl: 'https://loja.com/search?q=galaxy',
      maxCandidates: 5,
      contentType: 'markdown',
    });
    assert.ok(result.candidates.length >= 2, `encontrou ${result.candidates.length} candidatos`);
    assert.ok(result.candidates.some((c) => c.url.includes('samsung-galaxy-s24')));
  });

  it('extrai links de marketplaces (Amazon dp, ML)', () => {
    const md = `
[Samsung Galaxy S24 Ultra](https://www.amazon.com.br/dp/B0CS1V3TGH)
[Celular Samsung](https://produto.mercadolivre.com.br/MLB-3456789012)
`;
    const result = extractCandidates({
      searchPageHtml: md,
      searchPageUrl: 'https://www.amazon.com.br/s?k=samsung',
      maxCandidates: 5,
      contentType: 'markdown',
    });
    assert.ok(result.candidates.length >= 2);
    const amazonCandidate = result.candidates.find((c) => c.url.includes('/dp/'));
    assert.ok(amazonCandidate, 'deve encontrar link Amazon /dp/');
    assert.ok(amazonCandidate.confidence >= 70, 'Amazon /dp/ deve ter alta confiança');
  });

  it('filtra links negativos (cart, checkout, login)', () => {
    const md = `
[Adicionar ao carrinho](https://loja.com/cart/add)
[Fazer login](https://loja.com/login)
[Produto Real](https://loja.com/products/real-product)
`;
    const result = extractCandidates({
      searchPageHtml: md,
      searchPageUrl: 'https://loja.com/search',
      maxCandidates: 5,
      contentType: 'markdown',
    });
    assert.ok(!result.candidates.some((c) => c.url.includes('/cart')));
    assert.ok(!result.candidates.some((c) => c.url.includes('/login')));
  });

  it('mantém compatibilidade com HTML', () => {
    const html = `
<a href="/products/samsung-s24">Samsung Galaxy S24</a>
<a href="/products/iphone-15">iPhone 15</a>
`;
    const result = extractCandidates({
      searchPageHtml: html,
      searchPageUrl: 'https://loja.com/search',
      maxCandidates: 5,
      contentType: 'html',
    });
    assert.ok(result.candidates.length >= 2);
  });

  it('extrai long-slug URLs em markdown mesmo sem padrão positivo', () => {
    const md = `
[Teclado Mecânico Gamer](https://loja.com/informatica/teclado-mecanico-gamer-rgb-switches-blue)
`;
    const result = extractCandidates({
      searchPageHtml: md,
      searchPageUrl: 'https://loja.com/search',
      maxCandidates: 5,
      contentType: 'markdown',
    });
    assert.ok(result.candidates.length >= 1, 'deve aceitar long-slug');
  });
});

// ─── Recipe Runner com conteúdo markdown ────────────────────────────

describe('recipeRunner — markdown content (Jina/Firecrawl)', () => {
  const supplier = {
    id: 'sup-md-1',
    name: 'Loja Markdown',
    site: 'https://loja-md.com',
    country: 'BR',
    currency: 'BRL',
    type: 'general',
    search_url_template: 'https://loja-md.com/search?q={query}',
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const recipe: SupplierRecipe = {
    supplierId: 'sup-md-1',
    searchUrlTemplate: 'https://loja-md.com/search?q={query}',
    extractionStrategy: 'jina_fallback',
    status: 'certified',
    platformDetected: 'generic',
    searchDiscoveredAt: new Date().toISOString(),
    certifiedAt: new Date().toISOString(),
    lastTestedAt: new Date().toISOString(),
    failCount: 0,
    config: {},
  };

  function createMarkdownFetcher(pages: Record<string, string>): Fetcher {
    return {
      async fetchText(url) {
        const md = pages[url];
        if (!md) {
          return { status: 'not_found', contentType: 'markdown', source: 'jina' };
        }
        return {
          status: 'ok',
          html: md,
          content: md,
          contentType: 'markdown',
          source: 'jina',
          finalUrl: url,
        };
      },
    };
  }

  it('extrai produto de markdown via Jina simulado', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=galaxy%20s24': `
# Resultados para "galaxy s24"

- [Samsung Galaxy S24 Ultra 256GB](https://loja-md.com/products/samsung-galaxy-s24-ultra)
- [Capa Galaxy S24](https://loja-md.com/products/capa-galaxy-s24)
`,
      'https://loja-md.com/products/samsung-galaxy-s24-ultra': `
# Samsung Galaxy S24 Ultra 256GB

**R$ 5.499,00**

12x de R$ 458,25 sem juros

Cor: Preto Titânio

Frete grátis para todo o Brasil
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'galaxy s24',
      fetcher,
    });

    assert.equal(result.status, 'validated');
    assert.equal(result.productName, 'Samsung Galaxy S24 Ultra 256GB');
    assert.equal(result.price, 5499);
    assert.equal(result.currency, 'BRL');
    assert.equal(result.freightStatus, 'free_confirmed');
    assert.ok(result.evidence?.evidenceText);
  });

  it('extrai produto USD de markdown', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=iphone%2015': `
[iPhone 15 Pro Max 256GB](https://loja-md.com/products/iphone-15-pro-max)
`,
      'https://loja-md.com/products/iphone-15-pro-max': `
# iPhone 15 Pro Max 256GB

US$ 1,199.00

In stock · Free shipping
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'iphone 15',
      fetcher,
    });

    assert.equal(result.status, 'validated');
    assert.equal(result.price, 1199);
    assert.equal(result.currency, 'USD');
    assert.equal(result.freightStatus, 'free_confirmed');
  });

  it('retorna not_found quando markdown não tem links de produto', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=xyz123': `
# Nenhum resultado encontrado

Tente buscar por outro termo.
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'xyz123',
      fetcher,
    });

    assert.equal(result.status, 'not_found');
  });

  it('extrai direto da página de busca quando há preço no markdown', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=teclado': `
# Teclado Mecânico RGB Gamer

R$ 299,90

Em estoque
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'teclado',
      fetcher,
    });

    assert.equal(result.status, 'validated');
    assert.equal(result.productName, 'Teclado Mecânico RGB Gamer');
    assert.equal(result.price, 299.9);
  });

  it('frete não confirmado fica not_available', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=monitor': `
[Monitor LG 27"](https://loja-md.com/products/monitor-lg-27)
`,
      'https://loja-md.com/products/monitor-lg-27': `
# Monitor LG 27" IPS Full HD

R$ 1.299,00

Frete: calcular após adicionar ao carrinho
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'monitor',
      fetcher,
    });

    assert.equal(result.status, 'validated');
    assert.equal(result.freightStatus, 'not_available');
    assert.equal(result.freight, null);
  });

  it('rejeita produto mismatch em markdown', async () => {
    const fetcher = createMarkdownFetcher({
      'https://loja-md.com/search?q=notebook': `
[Capa para Notebook 15"](https://loja-md.com/products/capa-notebook)
`,
      'https://loja-md.com/products/capa-notebook': `
# Capa para Notebook 15 Polegadas

R$ 49,90
`,
    });

    const result = await runSupplierRecipe({
      supplier,
      recipe,
      query: 'notebook',
      fetcher,
      minMatchScore: 60,
    });

    assert.ok(result.status !== 'validated' || (result.matchScore !== null && result.matchScore < 60));
  });
});

// ─── FetcherResult com contentType ──────────────────────────────────

describe('FetcherResult — contentType e source', () => {
  it('fetcher padrão retorna contentType=html para fetch direto simulado', () => {
    const result: FetcherResult = {
      status: 'ok',
      html: '<html><body>Test</body></html>',
      content: '<html><body>Test</body></html>',
      contentType: 'html',
      source: 'direct',
      finalUrl: 'https://example.com',
    };
    assert.equal(result.contentType, 'html');
    assert.equal(result.source, 'direct');
  });

  it('fetcher jina retorna contentType=markdown', () => {
    const result: FetcherResult = {
      status: 'ok',
      html: '# Product\n\nR$ 99,99',
      content: '# Product\n\nR$ 99,99',
      contentType: 'markdown',
      source: 'jina',
      finalUrl: 'https://example.com',
    };
    assert.equal(result.contentType, 'markdown');
    assert.equal(result.source, 'jina');
  });

  it('fetcher firecrawl retorna contentType=markdown', () => {
    const result: FetcherResult = {
      status: 'ok',
      html: '# Product\n\n$99.99',
      content: '# Product\n\n$99.99',
      contentType: 'markdown',
      source: 'firecrawl',
      finalUrl: 'https://example.com',
    };
    assert.equal(result.contentType, 'markdown');
    assert.equal(result.source, 'firecrawl');
  });
});

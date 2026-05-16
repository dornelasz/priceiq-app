process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProductUrl } from '../services/urlValidator.js';
import type { Supplier } from '../services/supplierService.js';

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 'x', name: 'X', site: 'mercadolivre.com.br',
    search_url_template: 'https://lista.mercadolivre.com.br/{q}',
    country: 'Brasil', currency: 'BRL', type: 'Nacional', active: true,
    extraction_mode: 'jina_reader', extractor_config: {}, notes: null,
    created_at: '', updated_at: '', ...over,
  };
}

describe('urlValidator — Mercado Livre', () => {
  it('/MLB-XXXXX é product e validated', () => {
    const sup = supplier();
    const url = 'https://produto.mercadolivre.com.br/MLB-1234567890-iphone-13';
    const r = validateProductUrl(url, sup, `texto com ${url} dentro`, 'https://lista.mercadolivre.com.br/iphone');
    assert.equal(r.linkType, 'product');
    assert.equal(r.validated, true);
  });

  it('lista.mercadolivre.com.br é search, NÃO product', () => {
    const sup = supplier();
    const url = 'https://lista.mercadolivre.com.br/iphone-13-128gb';
    const r = validateProductUrl(url, sup, url, url);
    assert.notEqual(r.linkType, 'product');
  });
});

describe('urlValidator — Amazon', () => {
  it('/dp/ASIN é product', () => {
    const sup = supplier({ site: 'amazon.com.br' });
    const url = 'https://www.amazon.com.br/dp/B09G9HD6PD';
    const r = validateProductUrl(url, sup, `Cita o produto: ${url}`, 'https://amazon.com.br/s?k=iphone');
    assert.equal(r.linkType, 'product');
    assert.equal(r.validated, true);
  });

  it('/s?k= é search, NÃO product', () => {
    const sup = supplier({ site: 'amazon.com.br' });
    const url = 'https://www.amazon.com.br/s?k=iphone+13';
    const r = validateProductUrl(url, sup, url, url);
    assert.equal(r.linkType, 'search');
  });
});

describe('urlValidator — Shopee / AliExpress / Alibaba', () => {
  it('shopee -i.shopid.itemid é product', () => {
    const sup = supplier({ site: 'shopee.com.br' });
    const url = 'https://shopee.com.br/produto-name-i.12345.67890';
    const r = validateProductUrl(url, sup, url, 'https://shopee.com.br/search?keyword=x');
    assert.equal(r.linkType, 'product');
  });

  it('aliexpress /item/ é product', () => {
    const sup = supplier({ site: 'aliexpress.com' });
    const url = 'https://www.aliexpress.com/item/1005006789012345.html';
    const r = validateProductUrl(url, sup, url, 'https://aliexpress.com/wholesale?SearchText=x');
    assert.equal(r.linkType, 'product');
  });

  it('alibaba /product-detail/ é product', () => {
    const sup = supplier({ site: 'alibaba.com' });
    const url = 'https://www.alibaba.com/product-detail/Wireless-headphones_1600234567890.html';
    const r = validateProductUrl(url, sup, url, 'https://alibaba.com/trade/search?x=y');
    assert.equal(r.linkType, 'product');
  });
});

describe('urlValidator — anti produto fantasma', () => {
  it('rejeita URL inventada (não aparece no conteúdo)', () => {
    const sup = supplier();
    const url = 'https://produto.mercadolivre.com.br/MLB-INVENTADO-1234567890';
    const r = validateProductUrl(url, sup, 'conteúdo sem essa URL específica', 'https://lista.mercadolivre.com.br/iphone');
    assert.equal(r.linkType, 'search');
    assert.equal(r.validated, false);
    assert.match(r.validationWarning ?? '', /não foi encontrada na fonte/i);
  });

  it('rejeita URL de outro domínio', () => {
    const sup = supplier({ site: 'mercadolivre.com.br' });
    const url = 'https://example.com/produto/x';
    const r = validateProductUrl(url, sup, url, 'https://lista.mercadolivre.com.br/x');
    assert.equal(r.validated, false);
  });

  it('URL ausente → marca search se houver fallback', () => {
    const sup = supplier();
    const r = validateProductUrl(null, sup, '', 'https://lista.mercadolivre.com.br/iphone');
    assert.equal(r.linkType, 'search');
    assert.equal(r.link, 'https://lista.mercadolivre.com.br/iphone');
  });

  it('sem URL e sem fallback → unverified', () => {
    const sup = supplier();
    const r = validateProductUrl(null, sup, '', undefined);
    assert.equal(r.linkType, 'unverified');
    assert.equal(r.validated, false);
    assert.equal(r.link, null);
  });
});

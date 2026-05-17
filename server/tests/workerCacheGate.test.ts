/**
 * Testes da porta de qualidade do cache do worker (isCacheValid).
 *
 * isCacheValid garante que NUNCA são cacheados:
 *  - erros, timeouts, blocked, not_found
 *  - resultados sem evidência textual (produto-fantasma)
 *  - resultados sem URL rastreável (link ou sourceUrl)
 *  - resultados com status !== 'validated'
 */
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isCacheValid } = await import('../workers/priceSearchWorker.js');
type SR = import('../scrapers/jinaReaderScraper.js').ScrapedResult;

function valid(over: Partial<SR> = {}): SR {
  return {
    found: true,
    status: 'validated',
    price: 1299.99,
    currency: 'BRL',
    productName: 'Notebook Dell Inspiron 15',
    evidenceText: 'Notebook Dell Inspiron 15 R$ 1.299,99 em estoque',
    link: 'https://loja.com.br/notebook-dell-inspiron-15',
    sourceUrl: 'https://loja.com.br/busca?q=notebook+dell',
    ...over,
  };
}

describe('isCacheValid — resultado válido', () => {
  it('aceita resultado validated completo', () => {
    assert.equal(isCacheValid(valid()), true);
  });

  it('aceita sem sourceUrl quando tem link', () => {
    assert.equal(isCacheValid(valid({ sourceUrl: undefined })), true);
  });

  it('aceita sem link quando tem sourceUrl', () => {
    assert.equal(isCacheValid(valid({ link: undefined })), true);
  });
});

describe('isCacheValid — found=false → sempre rejeita', () => {
  it('rejeita found=false com status error', () => {
    assert.equal(isCacheValid({ found: false, status: 'error', errorMessage: 'falhou' }), false);
  });

  it('rejeita found=false com status timeout', () => {
    assert.equal(isCacheValid({ found: false, status: 'timeout' }), false);
  });

  it('rejeita found=false com status blocked', () => {
    assert.equal(isCacheValid({ found: false, status: 'blocked' }), false);
  });

  it('rejeita found=false com status not_found', () => {
    assert.equal(isCacheValid({ found: false, status: 'not_found' }), false);
  });
});

describe('isCacheValid — status inválido', () => {
  it('rejeita status cached (só validated entra no cache)', () => {
    assert.equal(isCacheValid(valid({ status: 'cached' })), false);
  });

  it('rejeita status product_mismatch', () => {
    assert.equal(isCacheValid(valid({ status: 'product_mismatch' })), false);
  });

  it('rejeita status price_not_found', () => {
    assert.equal(isCacheValid(valid({ status: 'price_not_found' })), false);
  });

  it('rejeita status invalid_link', () => {
    assert.equal(isCacheValid(valid({ status: 'invalid_link' })), false);
  });
});

describe('isCacheValid — preço inválido', () => {
  it('rejeita preço zero', () => {
    assert.equal(isCacheValid(valid({ price: 0 })), false);
  });

  it('rejeita preço negativo', () => {
    assert.equal(isCacheValid(valid({ price: -1 })), false);
  });

  it('rejeita preço undefined', () => {
    assert.equal(isCacheValid(valid({ price: undefined })), false);
  });
});

describe('isCacheValid — campos obrigatórios ausentes', () => {
  it('rejeita sem productName (undefined)', () => {
    assert.equal(isCacheValid(valid({ productName: undefined })), false);
  });

  it('rejeita sem productName (string vazia)', () => {
    assert.equal(isCacheValid(valid({ productName: '' })), false);
  });

  it('rejeita sem evidenceText (undefined) — anti produto-fantasma', () => {
    assert.equal(isCacheValid(valid({ evidenceText: undefined })), false);
  });

  it('rejeita sem evidenceText (string vazia) — anti produto-fantasma', () => {
    assert.equal(isCacheValid(valid({ evidenceText: '' })), false);
  });

  it('rejeita sem link E sem sourceUrl', () => {
    assert.equal(isCacheValid(valid({ link: undefined, sourceUrl: undefined })), false);
  });
});

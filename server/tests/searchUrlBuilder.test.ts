/**
 * Testes do construtor canônico de URLs de busca.
 * Sem rede, sem DB.
 */
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchUrl,
  hasPlaceholder,
  isValidSearchUrlTemplate,
  isValidSiteOrUrl,
  normalizeSite,
} from '../lib/searchUrlBuilder.js';

describe('hasPlaceholder', () => {
  it('detecta {q}', () => assert.equal(hasPlaceholder('https://x.com/?q={q}'), true));
  it('detecta {query}', () => assert.equal(hasPlaceholder('https://x.com/?q={query}'), true));
  it('detecta {produto}', () => assert.equal(hasPlaceholder('https://x.com/?q={produto}'), true));
  it('detecta case-insensitive', () => {
    assert.equal(hasPlaceholder('https://x.com/?q={Q}'), true);
    assert.equal(hasPlaceholder('https://x.com/?q={Query}'), true);
    assert.equal(hasPlaceholder('https://x.com/?q={PRODUTO}'), true);
  });
  it('não detecta sem placeholder', () => {
    assert.equal(hasPlaceholder('https://x.com/?q='), false);
    assert.equal(hasPlaceholder(''), false);
    assert.equal(hasPlaceholder(null), false);
    assert.equal(hasPlaceholder(undefined), false);
  });
  it('não confunde com placeholder parcial', () => {
    assert.equal(hasPlaceholder('https://x.com/?q={quantity}'), false);
  });
});

describe('buildSearchUrl — template com placeholder', () => {
  it('substitui {q} com query encoded', () => {
    const r = buildSearchUrl('https://amazon.com.br/s?k={q}', 'amazon.com.br', 'controle ps5');
    assert.equal(r.url, 'https://amazon.com.br/s?k=controle%20ps5');
    assert.equal(r.isFallback, false);
  });

  it('substitui {query} com query encoded', () => {
    const r = buildSearchUrl('https://x.com/find?term={query}', 'x.com', 'caneta bic');
    assert.equal(r.url, 'https://x.com/find?term=caneta%20bic');
    assert.equal(r.isFallback, false);
  });

  it('substitui {produto} com query encoded', () => {
    const r = buildSearchUrl('https://loja.com.br/busca/{produto}', 'loja.com.br', 'mouse logitech');
    assert.equal(r.url, 'https://loja.com.br/busca/mouse%20logitech');
    assert.equal(r.isFallback, false);
  });

  it('substitui placeholder case-insensitive', () => {
    const r = buildSearchUrl('https://x.com/?q={Q}', 'x.com', 'test');
    assert.equal(r.url, 'https://x.com/?q=test');
  });

  it('substitui múltiplas ocorrências', () => {
    const r = buildSearchUrl('https://x.com/{q}/page?q={q}', 'x.com', 'foo');
    assert.equal(r.url, 'https://x.com/foo/page?q=foo');
  });

  it('substitui placeholder no path (sem ?q=)', () => {
    const r = buildSearchUrl('https://lista.mercadolivre.com.br/{q}', 'mercadolivre.com.br', 'controle ps5');
    assert.equal(r.url, 'https://lista.mercadolivre.com.br/controle%20ps5');
  });

  it('encoda caracteres especiais', () => {
    const r = buildSearchUrl('https://x.com/?q={q}', 'x.com', 'café & açaí 50% off');
    assert.equal(r.url, 'https://x.com/?q=caf%C3%A9%20%26%20a%C3%A7a%C3%AD%2050%25%20off');
  });

  it('encoda query com aspas e símbolos', () => {
    const r = buildSearchUrl('https://x.com/?q={q}', 'x.com', `"iphone" 15 #pro`);
    assert.equal(r.url, 'https://x.com/?q=%22iphone%22%2015%20%23pro');
  });

  it('trim na query antes de encodar', () => {
    const r = buildSearchUrl('https://x.com/?q={q}', 'x.com', '  iphone  ');
    assert.equal(r.url, 'https://x.com/?q=iphone');
  });
});

describe('buildSearchUrl — template sem placeholder', () => {
  it('usa template como está (sem injeção)', () => {
    const r = buildSearchUrl('https://x.com/listing', 'x.com', 'foo');
    assert.equal(r.url, 'https://x.com/listing');
    assert.equal(r.isFallback, false);
  });
});

describe('buildSearchUrl — fallback (sem template)', () => {
  it('null → fallback /search?q=', () => {
    const r = buildSearchUrl(null, 'amazon.com.br', 'controle ps5');
    assert.equal(r.url, 'https://amazon.com.br/search?q=controle%20ps5');
    assert.equal(r.isFallback, true);
  });

  it('undefined → fallback', () => {
    const r = buildSearchUrl(undefined, 'amazon.com.br', 'foo');
    assert.equal(r.url, 'https://amazon.com.br/search?q=foo');
    assert.equal(r.isFallback, true);
  });

  it('string vazia → fallback', () => {
    const r = buildSearchUrl('', 'amazon.com.br', 'foo');
    assert.equal(r.isFallback, true);
    assert.equal(r.url, 'https://amazon.com.br/search?q=foo');
  });

  it('só espaços → fallback', () => {
    const r = buildSearchUrl('   ', 'amazon.com.br', 'foo');
    assert.equal(r.isFallback, true);
  });

  it('site com https → normaliza no fallback', () => {
    const r = buildSearchUrl('', 'https://amazon.com.br/', 'foo');
    assert.equal(r.url, 'https://amazon.com.br/search?q=foo');
  });

  it('site com www → normaliza no fallback', () => {
    const r = buildSearchUrl('', 'www.amazon.com.br', 'foo');
    assert.equal(r.url, 'https://amazon.com.br/search?q=foo');
  });

  it('fallback NUNCA gera URL de produto', () => {
    // Garante que o fallback é sempre /search?q= e não inventa rotas como /p/ ou /dp/
    const r = buildSearchUrl(null, 'loja-aleatoria.com', 'iphone 15');
    assert.ok(r.url.includes('/search?q='), `fallback deve ser /search?q=, recebeu ${r.url}`);
    assert.ok(!/\/(p|dp|product|produto|item)\//i.test(r.url), `fallback não pode ter rota de produto: ${r.url}`);
  });
});

describe('normalizeSite', () => {
  it('remove https://', () => assert.equal(normalizeSite('https://amazon.com.br'), 'amazon.com.br'));
  it('remove http://', () => assert.equal(normalizeSite('http://amazon.com.br'), 'amazon.com.br'));
  it('remove www.', () => assert.equal(normalizeSite('www.amazon.com.br'), 'amazon.com.br'));
  it('remove trailing slash', () => assert.equal(normalizeSite('amazon.com.br/'), 'amazon.com.br'));
  it('combinação', () => assert.equal(normalizeSite('https://www.amazon.com.br/'), 'amazon.com.br'));
  it('lowercase', () => assert.equal(normalizeSite('AMAZON.COM.BR'), 'amazon.com.br'));
});

describe('isValidSiteOrUrl', () => {
  it('aceita domínio simples', () => assert.equal(isValidSiteOrUrl('amazon.com.br'), true));
  it('aceita URL completa', () => assert.equal(isValidSiteOrUrl('https://amazon.com.br'), true));
  it('aceita URL com path', () => assert.equal(isValidSiteOrUrl('https://amazon.com.br/some/path'), true));
  it('aceita www', () => assert.equal(isValidSiteOrUrl('www.amazon.com.br'), true));
  it('rejeita string vazia', () => assert.equal(isValidSiteOrUrl(''), false));
  it('rejeita null', () => assert.equal(isValidSiteOrUrl(null), false));
  it('rejeita undefined', () => assert.equal(isValidSiteOrUrl(undefined), false));
  it('rejeita sem TLD', () => assert.equal(isValidSiteOrUrl('amazon'), false));
  it('rejeita localhost', () => assert.equal(isValidSiteOrUrl('localhost'), false));
  it('rejeita lixo', () => assert.equal(isValidSiteOrUrl('not a url at all !@#'), false));
  it('rejeita ftp', () => assert.equal(isValidSiteOrUrl('ftp://example.com'), false));
});

describe('isValidSearchUrlTemplate', () => {
  it('aceita URL com {q}', () => assert.equal(isValidSearchUrlTemplate('https://x.com/?q={q}'), true));
  it('aceita URL com {query}', () => assert.equal(isValidSearchUrlTemplate('https://x.com/?q={query}'), true));
  it('aceita URL com {produto}', () => assert.equal(isValidSearchUrlTemplate('https://x.com/{produto}'), true));
  it('aceita URL sem placeholder (UI deve avisar)', () => assert.equal(isValidSearchUrlTemplate('https://x.com/listing'), true));
  it('rejeita sem scheme', () => assert.equal(isValidSearchUrlTemplate('x.com/?q={q}'), false));
  it('rejeita string vazia', () => assert.equal(isValidSearchUrlTemplate(''), false));
  it('rejeita null', () => assert.equal(isValidSearchUrlTemplate(null), false));
  it('rejeita URL inválida', () => assert.equal(isValidSearchUrlTemplate('https://'), false));
  it('rejeita lixo', () => assert.equal(isValidSearchUrlTemplate('not a url at all'), false));
  it('rejeita ftp', () => assert.equal(isValidSearchUrlTemplate('ftp://example.com/?q={q}'), false));
});

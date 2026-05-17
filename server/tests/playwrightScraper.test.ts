/**
 * Testes do Playwright scraper.
 *
 * Cobertura:
 *  - looksBlocked: detecção de captcha/Cloudflare/recaptcha/hcaptcha
 *  - isPlaywrightAvailable retorna false quando PLAYWRIGHT_ENABLED=false
 *  - scrapeViaPlaywright retorna status='error' (não crasha) quando desabilitado
 *
 * Não testa execução real do browser — isso requer chromium instalado e seria
 * lento/frágil em CI. A presença do código real é validada por typecheck.
 */
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
// Garante que o teste roda no caminho desabilitado (padrão do config)
process.env['PLAYWRIGHT_ENABLED'] = 'false';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import — garante que process.env é setado antes do config.ts ser
// avaliado (config valida envs no top-level e crasha com process.exit(1)).
const { isPlaywrightAvailable, looksBlocked, scrapeViaPlaywright } =
  await import('../scrapers/genericPlaywrightScraper.js');
type Supplier = import('../services/supplierService.js').Supplier;

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Store',
    site: 'teststore.com.br',
    search_url_template: 'https://teststore.com.br/search?q={q}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

describe('looksBlocked — Cloudflare challenge', () => {
  it('detecta título "Just a moment"', () => {
    assert.equal(looksBlocked('<html></html>', 'short', 'Just a moment...'), true);
  });

  it('detecta título "Attention Required"', () => {
    assert.equal(looksBlocked('', 'short', 'Attention Required! | Cloudflare'), true);
  });

  it('detecta título "Checking your browser"', () => {
    assert.equal(looksBlocked('', '', 'Checking your browser before accessing'), true);
  });

  it('detecta iframe challenges.cloudflare.com', () => {
    const html = '<html><body><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge"></iframe></body></html>';
    assert.equal(looksBlocked(html, 'whatever', 'Page Title'), true);
  });

  it('detecta script challenges.cloudflare.com', () => {
    const html = '<html><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></html>';
    assert.equal(looksBlocked(html, 'whatever', 'Page Title'), true);
  });
});

describe('looksBlocked — reCAPTCHA / hCaptcha', () => {
  it('detecta iframe recaptcha', () => {
    const html = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>';
    assert.equal(looksBlocked(html, '', ''), true);
  });

  it('detecta iframe hcaptcha', () => {
    const html = '<iframe src="https://hcaptcha.com/captcha/v1/abc"></iframe>';
    assert.equal(looksBlocked(html, '', ''), true);
  });

  it('detecta script recaptcha api.js', () => {
    const html = '<script src="https://www.google.com/recaptcha/api.js"></script>';
    assert.equal(looksBlocked(html, '', ''), true);
  });
});

describe('looksBlocked — página curta com keywords', () => {
  it('detecta página curta com "captcha"', () => {
    assert.equal(
      looksBlocked('<html></html>', 'Please complete the captcha to continue', 'Verify'),
      true,
    );
  });

  it('detecta página curta com "enable javascript and cookies"', () => {
    assert.equal(
      looksBlocked('<html></html>', 'Please enable JavaScript and cookies to continue', ''),
      true,
    );
  });
});

describe('looksBlocked — falsos positivos', () => {
  it('NÃO marca página de produto normal como bloqueada', () => {
    const html = '<html><body><h1>iPhone 15</h1><span>R$ 5.999,00</span></body></html>';
    const text = 'iPhone 15 Pro 256GB Apple. R$ 5.999,00. Frete grátis. '.repeat(20);
    assert.equal(looksBlocked(html, text, 'iPhone 15 - Loja Online'), false);
  });

  it('NÃO marca como bloqueada quando título tem palavra inofensiva', () => {
    const html = '<html><body>conteúdo de produto normal e detalhado</body></html>';
    const text = 'Descrição completa do produto. '.repeat(50);
    assert.equal(looksBlocked(html, text, 'Mouse Gamer RGB 7200 DPI'), false);
  });

  it('NÃO marca página longa mesmo com palavra captcha em footer', () => {
    // Página real com captcha mencionado no footer / política mas conteúdo grande
    const text =
      'Produto: Notebook Dell Inspiron. Preço R$ 4.299,00. Especificações detalhadas. ' +
      'Política de privacidade menciona o uso de captcha em formulários. '.repeat(30);
    assert.equal(looksBlocked('<html></html>', text, 'Notebook Dell - Loja'), false);
  });
});

describe('isPlaywrightAvailable — desabilitado por padrão', () => {
  it('retorna false quando PLAYWRIGHT_ENABLED=false', async () => {
    const available = await isPlaywrightAvailable();
    assert.equal(available, false);
  });
});

describe('scrapeViaPlaywright — desabilitado', () => {
  it('retorna status="error" sem crashar quando desabilitado', async () => {
    const r = await scrapeViaPlaywright(supplier(), 'qualquer query', { timeoutMs: 5000 });
    assert.equal(r.found, false);
    assert.equal(r.status, 'error');
    assert.match(r.errorMessage ?? '', /desabilitado|não instalado/i);
    assert.equal(r.sourceName, 'playwright-disabled');
  });
});

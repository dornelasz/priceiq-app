/**
 * Etapa 11 — FirecrawlProvider (coletor v2) + validação de config.
 *
 * Nenhuma chamada real ao Firecrawl: o fetch global é mockado.
 *
 * Cobertura:
 *  - payload de scrape correto (formats markdown/html/links, sem schema/LLM)
 *  - success → html/markdown/links + finalUrl
 *  - 429 → rate_limited
 *  - 402 → no_credits
 *  - 401 → error (sem vazar a chave)
 *  - AbortError/timeout → timeout
 *  - destino 403 → blocked ; destino 404 → not_found ; challenge → blocked
 *  - a FIRECRAWL_API_KEY nunca aparece no resultado
 *  - config: FIRECRAWL_ENABLED=true sem chave → erro de validação
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { createFirecrawlProvider, buildFirecrawlScrapePayload } = await import(
  '../suppliers/v2/searchEngine/providers/firecrawlProvider.js'
);
const { envSchema } = await import('../config.js');

// ─── Mock do fetch global ─────────────────────────────────────────────────

type MockFetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;
let savedFetch: typeof globalThis.fetch;

function mockFetch(impl: MockFetchFn): void {
  savedFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>)['fetch'] = impl;
}
function restoreFetch(): void {
  (globalThis as Record<string, unknown>)['fetch'] = savedFetch;
}

function fcResponse(
  data: Record<string, unknown>,
  apiStatus = 200,
  success = true,
): Response {
  return new Response(JSON.stringify({ success, data }), {
    status: apiStatus,
    headers: { 'content-type': 'application/json' },
  });
}

const FC_KEY = 'fc-secret-key-123';

describe('FirecrawlProvider — payload de scrape', () => {
  it('buildFirecrawlScrapePayload pede markdown/html/links, sem schema/LLM/actions', () => {
    const payload = buildFirecrawlScrapePayload('https://x.com/p', 60000, 1000);
    assert.deepEqual(payload['formats'], ['markdown', 'html', 'links']);
    assert.equal(payload['onlyMainContent'], true);
    assert.equal(payload['proxy'], 'auto');
    assert.equal(payload['blockAds'], true);
    assert.equal(payload['storeInCache'], true);
    assert.equal(payload['timeout'], 60000);
    assert.equal(payload['waitFor'], 1000);
    // Nunca usa schema JSON, LLM ou actions.
    assert.equal(payload['jsonOptions'], undefined);
    assert.equal(payload['schema'], undefined);
    assert.equal(payload['actions'], undefined);
  });
});

describe('FirecrawlProvider — mapeamento de respostas', () => {
  afterEach(() => restoreFetch());

  it('chama POST {apiUrl}/scrape com Authorization Bearer e payload correto', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody: Record<string, unknown> = {};
    mockFetch(async (url, init) => {
      seenUrl = String(url);
      seenAuth = String((init?.headers as Record<string, string>)['Authorization'] ?? '');
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return fcResponse({ html: '<html><body>ok produto</body></html>', markdown: '# ok', links: [], metadata: { statusCode: 200, url } });
    });
    const provider = createFirecrawlProvider({ apiKey: FC_KEY, apiUrl: 'https://api.firecrawl.dev/v2' });
    await provider.fetchPage({ url: 'https://loja.com/p/1' });

    assert.equal(seenUrl, 'https://api.firecrawl.dev/v2/scrape');
    assert.equal(seenAuth, `Bearer ${FC_KEY}`);
    assert.deepEqual(seenBody['formats'], ['markdown', 'html', 'links']);
    assert.equal(seenBody['url'], 'https://loja.com/p/1');
  });

  it('success → status success com html, markdown e links', async () => {
    mockFetch(async () =>
      fcResponse({
        html: '<html><body><h1>Notebook</h1></body></html>',
        markdown: '# Notebook\nR$ 4.599,90',
        links: ['https://loja.com/p/1', 'https://loja.com/p/2'],
        metadata: { statusCode: 200, url: 'https://loja.com/busca' },
      }),
    );
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/busca' });
    assert.equal(res.status, 'success');
    assert.ok(res.html?.includes('Notebook'));
    assert.ok(res.markdown?.includes('4.599'));
    assert.deepEqual(res.links, ['https://loja.com/p/1', 'https://loja.com/p/2']);
    assert.equal(res.httpStatus, 200);
  });

  it('API 429 → rate_limited', async () => {
    mockFetch(async () => new Response('rate', { status: 429 }));
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'rate_limited');
    assert.equal(res.httpStatus, 429);
  });

  it('API 402 → no_credits', async () => {
    mockFetch(async () => new Response('no credits', { status: 402 }));
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'no_credits');
    assert.equal(res.httpStatus, 402);
  });

  it('API 401 → error controlado (sem vazar a chave)', async () => {
    mockFetch(async () => new Response('unauthorized', { status: 401 }));
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'error');
    assert.ok(res.errorMessage && !res.errorMessage.includes(FC_KEY), 'não vaza a chave');
  });

  it('AbortError → timeout', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p', timeoutMs: 1 });
    assert.equal(res.status, 'timeout');
  });

  it('destino 403 (metadata.statusCode) → blocked', async () => {
    mockFetch(async () =>
      fcResponse({ html: '<html>403</html>', metadata: { statusCode: 403, url: 'https://loja.com/p' } }),
    );
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.httpStatus, 403);
  });

  it('destino 404 → not_found', async () => {
    mockFetch(async () =>
      fcResponse({ html: '<html>404</html>', metadata: { statusCode: 404, url: 'https://loja.com/p' } }),
    );
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'not_found');
  });

  it('challenge anti-bot no conteúdo → blocked', async () => {
    mockFetch(async () =>
      fcResponse({
        html: '<html><body>Just a moment... Cloudflare</body></html>',
        markdown: 'Just a moment...',
        metadata: { statusCode: 200, url: 'https://loja.com/p' },
      }),
    );
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'blocked');
  });

  it('falha de rede (throw) → error controlado, nunca lança', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.equal(res.status, 'error');
    assert.ok(res.errorMessage);
  });

  it('nenhum campo do resultado contém a API key', async () => {
    mockFetch(async () =>
      fcResponse({ html: '<html>ok</html>', markdown: 'ok', links: [], metadata: { statusCode: 200, url: 'https://loja.com/p' } }),
    );
    const provider = createFirecrawlProvider({ apiKey: FC_KEY });
    const res = await provider.fetchPage({ url: 'https://loja.com/p' });
    assert.ok(!JSON.stringify(res).includes(FC_KEY), 'a chave nunca aparece no resultado');
  });
});

describe('config — FIRECRAWL_ENABLED exige FIRECRAWL_API_KEY', () => {
  const base = { DATABASE_URL: 'postgresql://test@localhost/test' };

  it('FIRECRAWL_ENABLED=true sem chave → erro de validação claro', () => {
    const parsed = envSchema.safeParse({ ...base, FIRECRAWL_ENABLED: 'true', FIRECRAWL_API_KEY: '' });
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'FIRECRAWL_API_KEY');
      assert.ok(issue, 'deve haver issue em FIRECRAWL_API_KEY');
      assert.ok(/FIRECRAWL_API_KEY/.test(issue!.message));
    }
  });

  it('FIRECRAWL_ENABLED=true COM chave → válido', () => {
    const parsed = envSchema.safeParse({ ...base, FIRECRAWL_ENABLED: 'true', FIRECRAWL_API_KEY: 'fc-xyz' });
    assert.equal(parsed.success, true);
  });

  it('FIRECRAWL_ENABLED=false sem chave → válido (não exige chave)', () => {
    const parsed = envSchema.safeParse({ ...base, FIRECRAWL_ENABLED: 'false', FIRECRAWL_API_KEY: '' });
    assert.equal(parsed.success, true);
  });
});

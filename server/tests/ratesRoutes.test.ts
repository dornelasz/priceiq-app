/**
 * Testes da rota /api/rates — hotfix do botão Atualizar.
 *
 * Cobertura:
 *  - GET /api/rates              → usa cache (force=false)
 *  - GET /api/rates?force=true   → ignora cache (canônico após hotfix)
 *  - GET /api/rates?force=1      → ignora cache
 *  - GET /api/rates?force=yes    → ignora cache
 *  - GET /api/rates?force=false  → usa cache
 *  - POST /api/rates/refresh     → ignora cache (compat)
 *  - Resposta com force inclui header Cache-Control: no-store
 *
 * Nenhum teste depende de internet, DB real ou Redis. O currencyService é
 * mockado via module replacement antes de importar a rota.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] =
  process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const Fastify = (await import('fastify')).default;
const { ratesRoutes } = await import('../routes/rates.js');
const currencyModule = await import('../services/currencyService.js');
const { cacheService } = await import('../services/cacheService.js');
const { closePool } = await import('../db/client.js');

after(async () => {
  // Sem isso, conexões de Redis/Postgres impediriam o processo de encerrar.
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

// ─── Helpers ────────────────────────────────────────────────────────────

interface FakeCall {
  force: boolean;
  at: number;
}

function makePayload(force: boolean, partial = false): {
  usd: number; eur: number; cny: number;
  source: string; fetched_at: string;
  from_cache: boolean; partial: boolean;
  warnings: { USD: null; EUR: null; CNY: null };
} {
  return {
    usd: force ? 5.1234 : 5.0000,
    eur: 5.5,
    cny: 0.7,
    source: 'Investing.com',
    fetched_at: new Date().toISOString(),
    from_cache: !force,
    partial,
    warnings: { USD: null, EUR: null, CNY: null },
  };
}

type GetRates = typeof currencyModule.currencyService.getRates;

async function buildApp(fakeGetRates: GetRates) {
  const original = currencyModule.currencyService.getRates;
  currencyModule.currencyService.getRates = fakeGetRates;

  const app = Fastify({ logger: false });
  await app.register(ratesRoutes);
  await app.ready();
  return {
    app,
    restore: () => {
      currencyModule.currencyService.getRates = original;
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('GET /api/rates (hotfix botão Atualizar)', () => {
  let calls: FakeCall[];

  beforeEach(() => {
    calls = [];
  });

  it('sem query param → chama getRates(false) e usa cache', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { from_cache: boolean };
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.force, false);
      assert.equal(body.from_cache, true);
    } finally {
      restore();
      await app.close();
    }
  });

  it('?force=true → chama getRates(true) e IGNORA cache', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=true' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { from_cache: boolean; usd: number };
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.force, true);
      assert.equal(body.from_cache, false);
      assert.equal(body.usd, 5.1234);
    } finally {
      restore();
      await app.close();
    }
  });

  it('?force=1 → também ignora cache', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=1' });
      assert.equal(res.statusCode, 200);
      assert.equal(calls[0]?.force, true);
    } finally {
      restore();
      await app.close();
    }
  });

  it('?force=yes → também ignora cache', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=yes' });
      assert.equal(res.statusCode, 200);
      assert.equal(calls[0]?.force, true);
    } finally {
      restore();
      await app.close();
    }
  });

  it('?force=false → mantém comportamento de cache', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=false' });
      assert.equal(res.statusCode, 200);
      assert.equal(calls[0]?.force, false);
    } finally {
      restore();
      await app.close();
    }
  });

  it('?force=true → resposta inclui Cache-Control: no-store', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=true' });
      const cc = res.headers['cache-control'];
      assert.ok(cc, 'esperado header Cache-Control');
      assert.match(String(cc), /no-store/);
    } finally {
      restore();
      await app.close();
    }
  });

  it('GET sem force → não força Cache-Control (deixa cliente decidir)', async () => {
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates' });
      const cc = res.headers['cache-control'];
      // Fastify pode adicionar headers default; só garantimos que NÃO declaramos no-store.
      if (cc) assert.doesNotMatch(String(cc), /no-store/);
    } finally {
      restore();
      await app.close();
    }
  });
});

describe('POST /api/rates/refresh (rota legada — ainda válida)', () => {
  it('POST → chama getRates(true) e devolve cotação fresca', async () => {
    const calls: FakeCall[] = [];
    const fake: GetRates = async (force = false) => {
      calls.push({ force, at: Date.now() });
      return makePayload(force);
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'POST', url: '/api/rates/refresh' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { from_cache: boolean };
      assert.equal(calls[0]?.force, true);
      assert.equal(body.from_cache, false);
      const cc = res.headers['cache-control'];
      assert.match(String(cc), /no-store/);
    } finally {
      restore();
      await app.close();
    }
  });
});

describe('Comportamento de erro — última cotação preservada', () => {
  it('Se getRates(true) lança, a rota responde 500 sem corromper estado', async () => {
    const fake: GetRates = async () => {
      throw new Error('Investing indisponível em todas as tentativas');
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=true' });
      // Fastify default: 500 em throw não tratado.
      assert.equal(res.statusCode, 500);
    } finally {
      restore();
      await app.close();
    }
  });

  it('Quando service retorna partial (Investing falhou mas BD tem último valor), rota devolve 200 com warnings', async () => {
    const fake: GetRates = async (force = false) => {
      const p = makePayload(force, true);
      p.warnings = { USD: 'Investing indisponível — exibindo último valor', EUR: null, CNY: null } as never;
      return p;
    };
    const { app, restore } = await buildApp(fake);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/rates?force=true' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { partial: boolean; warnings: Record<string, string | null> };
      assert.equal(body.partial, true);
      assert.ok(body.warnings.USD);
    } finally {
      restore();
      await app.close();
    }
  });
});

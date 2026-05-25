/**
 * Testes da rota de diagnóstico do motor próprio.
 *
 * Cobertura:
 *   1.  POST sem query → 400
 *   2.  GET sem query  → 400
 *   3.  POST com id inexistente → 404
 *   4.  POST pipeline validated → 200 com status validated
 *   5.  POST pipeline partial (frete desconhecido) → 200 com status partial
 *   6.  POST pipeline blocked → 200 com status blocked
 *   7.  Resposta NÃO contém HTML bruto (evidenceText truncado)
 *   8.  runPipeline recebe firecrawlEnabled=false (sem Firecrawl)
 *   9.  runPipeline recebe aiEnabled=false (sem IA)
 *   10. GET com query válida → 200
 *
 * Nenhum teste faz rede real. supplierService.get e runOwnSearchPipeline
 * são mockados via injeção de dependência no Fastify opts.
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] =
  process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';

const Fastify = (await import('fastify')).default;
const { suppliersRoutes } = await import('../routes/suppliers.js');
const supplierModule = await import('../services/supplierService.js');
const { isAppError, NotFoundError } = await import('../lib/errors.js');
const { cacheService } = await import('../services/cacheService.js');
const { closePool } = await import('../db/client.js');

import type { Supplier } from '../services/supplierService.js';
import type {
  RunOwnSearchPipelineInput,
  OwnSearchPipelineOutcome,
} from '../suppliers/v2/searchEngine/index.js';
import type { SuppliersRoutesOptions } from '../routes/suppliers.js';

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

// ─── Fixtures ────────────────────────────────────────────────────────────

const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    name: 'Loja Teste',
    site: 'loja.com.br',
    search_url_template: 'https://loja.com.br/busca?q={q}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    certificationStatus: 'unconfigured',
    setupStatus: 'unconfigured',
    autoConfiguredAt: null,
    recipe: null,
    ...overrides,
  };
}

function makeOutcome(
  status: 'validated' | 'partial' | 'blocked' | 'not_found' | 'price_not_found',
  freight = 'confirmed',
): OwnSearchPipelineOutcome {
  return {
    result: {
      status: status === 'partial' ? 'validated' : status,
      supplierId: SUPPLIER_ID,
      productName: status === 'blocked' ? null : 'Produto Teste 1TB',
      price: status === 'blocked' ? null : 99.9,
      currency: 'BRL',
      totalPrice: status === 'blocked' ? null : 99.9,
      freight: null,
      freightStatus: status === 'partial' ? 'not_available' : freight,
      productUrl: status === 'blocked' ? null : 'https://loja.com.br/produto/1',
      evidence: { evidenceText: 'Texto de evidência do produto' },
      matchScore: status === 'blocked' ? null : 0.9,
      confidence: status === 'blocked' ? null : 0.9,
      available: status === 'blocked' ? null : true,
      errorMessage: null,
    } as never,
    context: {
      supplierId: SUPPLIER_ID,
      query: 'produto teste',
      budgetUsage: { nativeFetches: 1, totalFetches: 1, extractions: 1, elapsedMs: 150 },
      diagnostics: { attempts: [] },
    } as never,
    candidateUrls: ['https://loja.com.br/produto/1'],
    attempts: [
      {
        step: 'search_fetch',
        status: 'fetched',
        providerName: 'native',
        url: 'https://loja.com.br/busca?q=produto+teste',
        at: new Date().toISOString(),
      },
    ] as never,
    elapsedMs: 150,
  };
}

// ─── buildApp ────────────────────────────────────────────────────────────

type FakePipeline = (input: RunOwnSearchPipelineInput) => Promise<OwnSearchPipelineOutcome>;

async function buildApp(
  fakeGetSupplier: () => Promise<Supplier>,
  fakePipeline: FakePipeline,
) {
  const originalGet = supplierModule.supplierService.get;
  supplierModule.supplierService.get = fakeGetSupplier as typeof supplierModule.supplierService.get;

  const app = Fastify({ logger: false });

  // Replica o errorHandler de produção (server/index.ts)
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Entrada inválida',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (isAppError(error)) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: (error as Error).message || 'Erro interno' });
  });

  const opts: SuppliersRoutesOptions = { runOwnSearchPipelineImpl: fakePipeline };
  await app.register(suppliersRoutes, opts);
  await app.ready();

  return {
    app,
    restore: () => {
      supplierModule.supplierService.get = originalGet;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('POST /api/suppliers/:id/test-own-search', () => {
  it('sem query no body → 400', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => { throw new Error('não deveria ser chamado'); },
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: {},
      });
      assert.equal(res.statusCode, 400);
    } finally {
      restore();
      await app.close();
    }
  });

  it('id inexistente → 404', async () => {
    const { app, restore } = await buildApp(
      async () => { throw new NotFoundError('Fornecedor'); },
      async () => { throw new Error('não deveria ser chamado'); },
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'notebook' },
      });
      assert.equal(res.statusCode, 404);
    } finally {
      restore();
      await app.close();
    }
  });

  it('pipeline validated → 200 com status validated', async () => {
    const outcome = makeOutcome('validated', 'confirmed');
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => outcome,
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto teste' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ ok: boolean; status: string; result: { price: number } }>();
      assert.equal(body.ok, true);
      assert.equal(body.status, 'validated');
      assert.equal(body.result.price, 99.9);
    } finally {
      restore();
      await app.close();
    }
  });

  it('pipeline partial (frete não confirmado) → 200 com status partial', async () => {
    const outcome = makeOutcome('partial', 'not_available');
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => outcome,
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto teste' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ status: string; result: { freightStatus: string } }>();
      assert.equal(body.status, 'partial');
      assert.equal(body.result.freightStatus, 'not_available');
    } finally {
      restore();
      await app.close();
    }
  });

  it('pipeline blocked → 200 com status blocked', async () => {
    const outcome = makeOutcome('blocked');
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => outcome,
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto teste' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ status: string }>();
      assert.equal(body.status, 'blocked');
    } finally {
      restore();
      await app.close();
    }
  });

  it('resposta não contém HTML bruto — evidenceText truncado a 500 chars', async () => {
    const longHtml = '<html>' + 'x'.repeat(1000) + '</html>';
    const outcome = makeOutcome('validated', 'confirmed');
    const resultWithLongEvidence = {
      ...outcome,
      result: {
        ...outcome.result,
        evidence: { evidenceText: longHtml },
      } as never,
    };
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => resultWithLongEvidence,
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto teste' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ result: { evidenceText: string | null } }>();
      const ev = body.result.evidenceText ?? '';
      // evidenceText deve ter no máximo 501 chars (500 + "…")
      assert.ok(ev.length <= 502, `evidenceText muito longo: ${ev.length}`);
      assert.ok(!ev.includes('</html>'), 'HTML bruto não deve aparecer sem truncamento');
    } finally {
      restore();
      await app.close();
    }
  });

  it('pipeline NÃO recebe firecrawlEnabled=true — Firecrawl sempre desligado', async () => {
    const calls: RunOwnSearchPipelineInput[] = [];
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async (input: RunOwnSearchPipelineInput) => {
        calls.push(input);
        return makeOutcome('validated');
      },
    );
    try {
      await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto' },
      });
      assert.equal(calls.length, 1);
      // A rota não passa providerPolicy → pipeline usa defaults (firecrawlEnabled=false)
      assert.ok(
        !calls[0]?.providerPolicy?.firecrawlEnabled,
        'firecrawlEnabled deve ser falso ou ausente',
      );
    } finally {
      restore();
      await app.close();
    }
  });

  it('pipeline NÃO recebe aiEnabled=true — IA sempre desligada', async () => {
    const calls: RunOwnSearchPipelineInput[] = [];
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async (input: RunOwnSearchPipelineInput) => {
        calls.push(input);
        return makeOutcome('validated');
      },
    );
    try {
      await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
        payload: { query: 'produto' },
      });
      assert.equal(calls.length, 1);
      assert.ok(
        !calls[0]?.providerPolicy?.aiEnabled,
        'aiEnabled deve ser falso ou ausente',
      );
    } finally {
      restore();
      await app.close();
    }
  });
});

describe('GET /api/suppliers/:id/test-own-search', () => {
  it('sem query param → 400', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => { throw new Error('não deveria ser chamado'); },
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search`,
      });
      assert.equal(res.statusCode, 400);
    } finally {
      restore();
      await app.close();
    }
  });

  it('com query válida → 200 e resposta completa', async () => {
    const outcome = makeOutcome('validated', 'free_confirmed');
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => outcome,
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/test-own-search?query=notebook`,
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        ok: boolean;
        supplierId: string;
        supplierName: string;
        query: string;
        status: string;
        diagnostics: { candidateUrls: string[]; elapsedMs: number };
      }>();
      assert.equal(body.ok, true);
      assert.equal(body.supplierId, SUPPLIER_ID);
      assert.equal(body.supplierName, 'Loja Teste');
      assert.equal(body.query, 'notebook');
      assert.ok(Array.isArray(body.diagnostics.candidateUrls));
      assert.ok(typeof body.diagnostics.elapsedMs === 'number');
    } finally {
      restore();
      await app.close();
    }
  });
});

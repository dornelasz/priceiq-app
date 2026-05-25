/**
 * Etapa 16 — Testes da rota POST /api/suppliers/:id/process-catalog.
 *
 * supplierService.get e processCatalogCandidates são injetados (sem rede real).
 *
 * Cobertura:
 *   1. POST sem query → 400
 *   2. POST id inexistente → 404
 *   3. POST válido → 200 com resumo (counts + statusBreakdown)
 *   4. no_candidates → recomendação presente
 *   5. resposta não contém HTML bruto nem FIRECRAWL_API_KEY
 *   6. repassa maxCandidates/minMatchScore ao processador
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

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
import type { SuppliersRoutesOptions } from '../routes/suppliers.js';
import type {
  CatalogProcessingInput,
  CatalogProcessingResult,
} from '../suppliers/v2/searchEngine/catalogProcessing/index.js';

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    name: 'Kabum',
    site: 'www.kabum.com.br',
    search_url_template: 'https://www.kabum.com.br/busca?query={q}',
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
    ...over,
  };
}

function makeResult(over: Partial<CatalogProcessingResult> = {}): CatalogProcessingResult {
  return {
    supplierId: SUPPLIER_ID,
    query: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    status: 'completed',
    candidatesProcessed: 3,
    candidatesUpdated: 3,
    matchesCreated: 2,
    matchesRejected: 1,
    statusBreakdown: { validated: 2, product_mismatch: 1 },
    processed: [],
    attempts: [
      {
        step: 'extraction',
        status: 'validated',
        url: 'https://www.kabum.com.br/produto/111',
        detail: 'status: validated',
        at: new Date().toISOString(),
      },
    ],
    errors: [],
    ...over,
  };
}

type FakeProcess = (input: CatalogProcessingInput) => Promise<CatalogProcessingResult>;

async function buildApp(
  fakeGetSupplier: () => Promise<Supplier>,
  fakeProcess: FakeProcess,
) {
  const originalGet = supplierModule.supplierService.get;
  supplierModule.supplierService.get =
    fakeGetSupplier as typeof supplierModule.supplierService.get;

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Entrada inválida' });
      return;
    }
    if (isAppError(error)) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  });

  const opts: SuppliersRoutesOptions = { processCatalogCandidatesImpl: fakeProcess };
  await app.register(suppliersRoutes, opts);
  await app.ready();

  return {
    app,
    restore: () => {
      supplierModule.supplierService.get = originalGet;
    },
  };
}

describe('POST /api/suppliers/:id/process-catalog', () => {
  it('sem query → 400', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => {
        throw new Error('não deveria ser chamado');
      },
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
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
      async () => {
        throw new NotFoundError('Fornecedor');
      },
      async () => {
        throw new Error('não deveria ser chamado');
      },
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
        payload: { query: 'ssd' },
      });
      assert.equal(res.statusCode, 404);
    } finally {
      restore();
      await app.close();
    }
  });

  it('válido → 200 com resumo', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => makeResult(),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
        payload: { query: 'ssd 1tb nvme', maxCandidates: 5, minMatchScore: 70 },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        ok: boolean;
        supplierName: string;
        candidatesProcessed: number;
        matchesCreated: number;
        statusBreakdown: Record<string, number>;
      }>();
      assert.equal(body.ok, true);
      assert.equal(body.supplierName, 'Kabum');
      assert.equal(body.candidatesProcessed, 3);
      assert.equal(body.matchesCreated, 2);
      assert.equal(body.statusBreakdown['validated'], 2);
    } finally {
      restore();
      await app.close();
    }
  });

  it('no_candidates → resposta traz recomendação', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () =>
        makeResult({
          status: 'no_candidates',
          candidatesProcessed: 0,
          candidatesUpdated: 0,
          matchesCreated: 0,
          matchesRejected: 0,
          statusBreakdown: {},
          recommendation: 'Rode POST /api/suppliers/:id/discover-catalog primeiro.',
        }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
        payload: { query: 'inexistente' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ status: string; recommendation?: string }>();
      assert.equal(body.status, 'no_candidates');
      assert.ok(body.recommendation?.includes('discover-catalog'));
    } finally {
      restore();
      await app.close();
    }
  });

  it('repassa maxCandidates e minMatchScore ao processador', async () => {
    const captured: CatalogProcessingInput[] = [];
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async (input) => {
        captured.push(input);
        return makeResult();
      },
    );
    try {
      await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
        payload: { query: 'ssd', maxCandidates: 8, minMatchScore: 60 },
      });
      assert.equal(captured.length, 1);
      assert.equal(captured[0]!.maxCandidates, 8);
      assert.equal(captured[0]!.minMatchScore, 60);
    } finally {
      restore();
      await app.close();
    }
  });

  it('resposta não contém HTML bruto nem a FIRECRAWL_API_KEY', async () => {
    const longHtml = '<html><body>' + 'x'.repeat(1000) + '</body></html>';
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () =>
        makeResult({
          attempts: [
            {
              step: 'candidate_fetch',
              status: 'native_fetch_success',
              providerName: 'native',
              detail: longHtml + ' Authorization Bearer fc-secret-LEAK-999',
              at: new Date().toISOString(),
            },
          ],
        }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/process-catalog`,
        payload: { query: 'ssd' },
      });
      assert.equal(res.statusCode, 200);
      const raw = res.body;
      assert.ok(!raw.includes('</body></html>'), 'HTML bruto não deve aparecer');
      assert.ok(!raw.includes('fc-secret-LEAK-999'), 'chave não deve vazar');
    } finally {
      restore();
      await app.close();
    }
  });
});

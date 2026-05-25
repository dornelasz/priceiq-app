/**
 * Etapa 15 — Testes da rota POST /api/suppliers/:id/discover-catalog.
 *
 * Cobertura:
 *   1. POST sem query → 400
 *   2. POST com id inexistente → 404
 *   3. POST válido → 200 com resumo (counts + sourceBreakdown)
 *   4. resposta NÃO contém HTML bruto (attempts sanitizados/truncados)
 *   5. resposta NÃO vaza FIRECRAWL_API_KEY
 *   6. a rota repassa sources/maxCandidates ao runCatalogDiscovery
 *
 * Nenhuma chamada de rede real: supplierService.get e runCatalogDiscovery são
 * injetados via opts do Fastify.
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
  CatalogDiscoveryInput,
  CatalogDiscoveryResult,
} from '../suppliers/v2/searchEngine/catalogDiscovery/index.js';

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
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
    ...overrides,
  };
}

function makeResult(overrides: Partial<CatalogDiscoveryResult> = {}): CatalogDiscoveryResult {
  return {
    supplierId: SUPPLIER_ID,
    query: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    reusableMatches: 0,
    candidatesFound: 2,
    candidatesSaved: 2,
    candidatesRejected: 0,
    sourceBreakdown: [
      {
        source: 'firecrawl_search',
        runId: 'run-1',
        status: 'completed',
        fetchStatus: 'success',
        candidatesFound: 2,
        candidatesSaved: 2,
        candidatesRejected: 0,
      },
    ],
    discoveryRunIds: ['run-1'],
    attempts: [
      {
        step: 'firecrawl_search',
        status: 'external_fetch_success',
        providerName: 'firecrawl',
        detail: 'search "ssd site:kabum.com.br" → 2 URL(s) (success)',
        at: new Date().toISOString(),
      },
    ],
    errors: [],
    ...overrides,
  };
}

type FakeDiscovery = (input: CatalogDiscoveryInput) => Promise<CatalogDiscoveryResult>;

async function buildApp(
  fakeGetSupplier: () => Promise<Supplier>,
  fakeDiscovery: FakeDiscovery,
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

  const opts: SuppliersRoutesOptions = { runCatalogDiscoveryImpl: fakeDiscovery };
  await app.register(suppliersRoutes, opts);
  await app.ready();

  return {
    app,
    restore: () => {
      supplierModule.supplierService.get = originalGet;
    },
  };
}

describe('POST /api/suppliers/:id/discover-catalog', () => {
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
        url: `/api/suppliers/${SUPPLIER_ID}/discover-catalog`,
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
        url: `/api/suppliers/${SUPPLIER_ID}/discover-catalog`,
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
        url: `/api/suppliers/${SUPPLIER_ID}/discover-catalog`,
        payload: { query: 'ssd 1tb nvme' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        ok: boolean;
        supplierName: string;
        candidatesSaved: number;
        sourceBreakdown: unknown[];
        discoveryRunIds: string[];
      }>();
      assert.equal(body.ok, true);
      assert.equal(body.supplierName, 'Kabum');
      assert.equal(body.candidatesSaved, 2);
      assert.equal(body.sourceBreakdown.length, 1);
      assert.deepEqual(body.discoveryRunIds, ['run-1']);
    } finally {
      restore();
      await app.close();
    }
  });

  it('repassa sources e maxCandidates ao runCatalogDiscovery', async () => {
    const captured: CatalogDiscoveryInput[] = [];
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
        url: `/api/suppliers/${SUPPLIER_ID}/discover-catalog`,
        payload: { query: 'ssd', sources: ['sitemap', 'search_page'], maxCandidates: 7 },
      });
      assert.equal(captured.length, 1);
      assert.deepEqual(captured[0]!.sources, ['sitemap', 'search_page']);
      assert.equal(captured[0]!.maxCandidates, 7);
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
              step: 'search_page',
              status: 'native_fetch_success',
              providerName: 'native',
              // detail com HTML longo + uma chave fictícia — deve ser truncado
              detail: longHtml + ' Authorization Bearer fc-secret-LEAK-123',
              at: new Date().toISOString(),
            },
          ],
        }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/discover-catalog`,
        payload: { query: 'ssd' },
      });
      assert.equal(res.statusCode, 200);
      const raw = res.body;
      // detail truncado a ~300 chars → o HTML completo e a chave no fim somem
      assert.ok(!raw.includes('</body></html>'), 'HTML bruto não deve aparecer');
      assert.ok(!raw.includes('fc-secret-LEAK-123'), 'chave não deve vazar');
    } finally {
      restore();
      await app.close();
    }
  });
});

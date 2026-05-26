/**
 * Etapa 17 — Testes da rota POST /api/suppliers/:id/catalog-search.
 *
 * supplierService.get e runCatalogFirstSupplierSearch são injetados
 * (sem rede real).
 *
 * Cobertura:
 *   1. POST sem query → 400
 *   2. POST id inexistente → 404
 *   3. POST válido → 200 com strategy e usefulResults
 *   4. strategy=reused_matches retornada corretamente
 *   5. resposta não contém HTML bruto nem FIRECRAWL_API_KEY
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
  CatalogSearchInput,
  CatalogSearchResult,
} from '../suppliers/v2/searchEngine/catalogSearch/index.js';

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

function makeSearchResult(
  over: Partial<CatalogSearchResult> = {},
): CatalogSearchResult {
  return {
    supplierId: SUPPLIER_ID,
    query: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    status: 'completed',
    strategy: 'reused_matches',
    reusedMatchesCount: 2,
    candidatesDiscovered: 0,
    candidatesProcessed: 2,
    matchesCreated: 2,
    usefulResults: [
      {
        candidateId: 'cccccccc-1111-2222-3333-444444444444',
        productUrl: 'https://www.kabum.com.br/produto/111',
        productName: 'SSD Kingston 1TB NVMe',
        price: 299.9,
        currency: 'BRL',
        priceBrl: 299.9,
        freight: 0,
        freightStatus: 'free_confirmed',
        totalBrl: 299.9,
        matchScore: 85,
        confidence: 90,
        evidenceText: 'SSD Kingston 1TB NVMe — R$ 299,90',
        status: 'validated',
        matchStatus: 'confirmed',
      },
    ],
    failures: [],
    attempts: [],
    diagnostics: {
      reusableMatchesFound: 2,
      candidatesDiscoveredBySource: {},
      processingStatusBreakdown: { validated: 2 },
      attemptCount: 0,
    },
    errors: [],
    ...over,
  };
}

type FakeSearch = (input: CatalogSearchInput) => Promise<CatalogSearchResult>;

async function buildApp(
  fakeGetSupplier: () => Promise<Supplier>,
  fakeSearch: FakeSearch,
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

  const opts: SuppliersRoutesOptions = { runCatalogSearchImpl: fakeSearch };
  await app.register(suppliersRoutes, opts);
  await app.ready();

  return {
    app,
    restore: () => {
      supplierModule.supplierService.get = originalGet;
    },
  };
}

describe('POST /api/suppliers/:id/catalog-search', () => {
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
        url: `/api/suppliers/${SUPPLIER_ID}/catalog-search`,
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
        url: `/api/suppliers/${SUPPLIER_ID}/catalog-search`,
        payload: { query: 'ssd' },
      });
      assert.equal(res.statusCode, 404);
    } finally {
      restore();
      await app.close();
    }
  });

  it('válido → 200 com strategy e usefulResults', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () => makeSearchResult(),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog-search`,
        payload: { query: 'ssd 1tb nvme' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        ok: boolean;
        supplierName: string;
        strategy: string;
        usefulResults: unknown[];
        status: string;
      }>();
      assert.equal(body.ok, true);
      assert.equal(body.supplierName, 'Kabum');
      assert.equal(body.strategy, 'reused_matches');
      assert.equal(body.usefulResults.length, 1);
      assert.equal(body.status, 'completed');
    } finally {
      restore();
      await app.close();
    }
  });

  it('strategy=discovered_then_processed retornada corretamente', async () => {
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () =>
        makeSearchResult({
          strategy: 'discovered_then_processed',
          reusedMatchesCount: 0,
          candidatesDiscovered: 5,
        }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog-search`,
        payload: { query: 'notebook gamer', maxDiscoveryCandidates: 20 },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ strategy: string; candidatesDiscovered: number }>();
      assert.equal(body.strategy, 'discovered_then_processed');
      assert.equal(body.candidatesDiscovered, 5);
    } finally {
      restore();
      await app.close();
    }
  });

  it('resposta não contém HTML bruto nem FIRECRAWL_API_KEY', async () => {
    const longHtml = '<html><body>' + 'x'.repeat(1000) + '</body></html>';
    const { app, restore } = await buildApp(
      async () => makeSupplier(),
      async () =>
        makeSearchResult({
          attempts: [
            {
              step: 'candidate_fetch',
              status: 'native_fetch_success',
              providerName: 'native',
              detail: longHtml + ' Authorization Bearer fc-secret-LEAK-ROTA',
              at: new Date().toISOString(),
            },
          ],
        }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog-search`,
        payload: { query: 'ssd' },
      });
      assert.equal(res.statusCode, 200);
      const raw = res.body;
      assert.ok(!raw.includes('</body></html>'), 'HTML bruto não deve aparecer');
      assert.ok(!raw.includes('fc-secret-LEAK-ROTA'), 'API key não deve vazar');
    } finally {
      restore();
      await app.close();
    }
  });
});

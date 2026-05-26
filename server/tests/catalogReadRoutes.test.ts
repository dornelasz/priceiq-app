/**
 * Etapa 19A — Testes das rotas de leitura do catálogo.
 *
 *   GET /api/suppliers/:id/catalog/candidates?query=...
 *   GET /api/suppliers/:id/catalog/matches?query=...
 *   GET /api/suppliers/:id/catalog/discovery-runs?query=...
 *
 * catalogServiceImpl é injetado — sem DB real, sem scraping, sem Firecrawl.
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
  SupplierProductCandidate,
  SupplierProductMatch,
  SupplierDiscoveryRun,
  SupplierProductCatalogService,
} from '../suppliers/v2/catalog/index.js';

after(async () => {
  await cacheService.close().catch(() => {});
  await closePool().catch(() => {});
});

const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CANDIDATE_ID = 'cccccccc-1111-2222-3333-444444444444';

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

function makeCandidate(over: Partial<SupplierProductCandidate> = {}): SupplierProductCandidate {
  return {
    id: CANDIDATE_ID,
    supplierId: SUPPLIER_ID,
    queryText: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    productUrl: 'https://www.kabum.com.br/produto/111',
    canonicalUrl: null,
    urlHash: 'abc123',
    source: 'search_page',
    status: 'matched',
    productName: 'SSD Kingston 1TB NVMe',
    brand: 'Kingston',
    sku: 'SKY-001',
    price: 299.9,
    currency: 'BRL',
    priceBrl: 299.9,
    freight: null,
    freightStatus: 'unknown',
    totalBrl: null,
    matchScore: 92,
    confidence: 0.9,
    evidenceText: 'SSD Kingston 1TB NVMe Gen4 em estoque',
    priceEvidenceText: 'R$ 299,90',
    lastCheckedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function makeMatch(over: Partial<SupplierProductMatch> = {}): SupplierProductMatch {
  return {
    id: 'mmmmmmmm-1111-2222-3333-444444444444',
    supplierId: SUPPLIER_ID,
    candidateId: CANDIDATE_ID,
    queryText: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    matchStatus: 'confirmed',
    matchScore: 92,
    confidence: 0.9,
    reason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function makeRun(over: Partial<SupplierDiscoveryRun> = {}): SupplierDiscoveryRun {
  return {
    id: 'rrrrrrrr-1111-2222-3333-444444444444',
    supplierId: SUPPLIER_ID,
    queryText: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    source: 'search_page',
    status: 'completed',
    candidatesFound: 5,
    candidatesSaved: 5,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...over,
  };
}

function makeNoop(): SupplierProductCatalogService {
  const notImpl = () => { throw new Error('not implemented'); };
  return {
    upsertCandidate: notImpl,
    listCandidatesByQuery: async () => [],
    listReusableMatches: async () => [],
    listMatchesByQuery: async () => [],
    listDiscoveryRunsByQuery: async () => [],
    updateCandidateExtraction: notImpl,
    createDiscoveryRun: notImpl,
    finishDiscoveryRun: notImpl,
    createOrUpdateMatch: notImpl,
  };
}

async function buildApp(opts: SuppliersRoutesOptions = {}) {
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
  await app.register(suppliersRoutes, opts);
  return app;
}

// ─── candidates ───────────────────────────────────────────────────────────────

describe('GET /catalog/candidates', () => {
  it('retorna lista vazia quando não há candidatos', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/candidates?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.count, 0);
      assert.deepEqual(body.candidates, []);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('retorna candidatos encontrados', async () => {
    const candidate = makeCandidate();
    const svc: SupplierProductCatalogService = {
      ...makeNoop(),
      listCandidatesByQuery: async () => [candidate],
    };
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: svc });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/candidates?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      assert.equal(body.candidates[0].id, CANDIDATE_ID);
      assert.equal(body.candidates[0].productUrl, candidate.productUrl);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('query ausente → 400', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/candidates`,
      });
      assert.equal(res.statusCode, 400);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('supplierId inválido (não-UUID) → 400', async () => {
    const app = await buildApp({ catalogServiceImpl: makeNoop() });
    const res = await app.inject({
      method: 'GET',
      url: `/api/suppliers/nao-uuid/catalog/candidates?query=ssd`,
    });
    assert.equal(res.statusCode, 400);
  });

  it('fornecedor não encontrado → 404', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => {
      throw new NotFoundError('Supplier not found');
    };
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/candidates?query=ssd`,
      });
      assert.equal(res.statusCode, 404);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('resposta não contém HTML bruto nem FIRECRAWL_API_KEY', async () => {
    const candidate = makeCandidate({
      evidenceText: 'Produto normal sem HTML',
    });
    const svc: SupplierProductCatalogService = {
      ...makeNoop(),
      listCandidatesByQuery: async () => [candidate],
    };
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: svc });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/candidates?query=ssd`,
      });
      const body = res.body;
      assert.ok(!body.includes('<html'), 'resposta não deve conter HTML bruto');
      assert.ok(!body.includes('FIRECRAWL_API_KEY'), 'chave não deve aparecer');
    } finally {
      supplierModule.supplierService.get = get;
    }
  });
});

// ─── matches ──────────────────────────────────────────────────────────────────

describe('GET /catalog/matches', () => {
  it('retorna lista vazia quando não há matches', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/matches?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.count, 0);
      assert.deepEqual(body.matches, []);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('retorna matches encontrados', async () => {
    const match = makeMatch();
    const svc: SupplierProductCatalogService = {
      ...makeNoop(),
      listMatchesByQuery: async () => [match],
    };
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: svc });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/matches?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      assert.equal(body.matches[0].matchStatus, 'confirmed');
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('query ausente → 400', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/matches`,
      });
      assert.equal(res.statusCode, 400);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('fornecedor não encontrado → 404', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => {
      throw new NotFoundError('Supplier not found');
    };
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/matches?query=ssd`,
      });
      assert.equal(res.statusCode, 404);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });
});

// ─── discovery-runs ───────────────────────────────────────────────────────────

describe('GET /catalog/discovery-runs', () => {
  it('retorna lista vazia quando não há runs', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/discovery-runs?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.count, 0);
      assert.deepEqual(body.runs, []);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('retorna runs encontrados', async () => {
    const run = makeRun();
    const svc: SupplierProductCatalogService = {
      ...makeNoop(),
      listDiscoveryRunsByQuery: async () => [run],
    };
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: svc });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/discovery-runs?query=ssd+1tb+nvme`,
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      assert.equal(body.runs[0].status, 'completed');
      assert.equal(body.runs[0].candidatesFound, 5);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('query ausente → 400', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => makeSupplier();
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/discovery-runs`,
      });
      assert.equal(res.statusCode, 400);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });

  it('fornecedor não encontrado → 404', async () => {
    const get = supplierModule.supplierService.get;
    supplierModule.supplierService.get = async () => {
      throw new NotFoundError('Supplier not found');
    };
    try {
      const app = await buildApp({ catalogServiceImpl: makeNoop() });
      const res = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${SUPPLIER_ID}/catalog/discovery-runs?query=ssd`,
      });
      assert.equal(res.statusCode, 404);
    } finally {
      supplierModule.supplierService.get = get;
    }
  });
});

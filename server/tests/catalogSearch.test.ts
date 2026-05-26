/**
 * Etapa 17 — Catalog-First Search.
 *
 * catalogService, runCatalogDiscoveryFn e processCatalogCandidatesFn são
 * injetados (sem rede real, sem banco real, sem IA).
 *
 * Cobre:
 *  1. usa matches reutilizáveis quando existem (strategy='reused_matches')
 *  2. NÃO roda discovery quando há matches reutilizáveis
 *  3. roda discovery quando não há matches (strategy='discovered_then_processed')
 *  4. roda processing depois do discovery
 *  5. validated entra como usefulResult
 *  6. partial entra como usefulResult (frete permanece null)
 *  7. product_mismatch fica em failures
 *  8. blocked fica em failures
 *  9. no_candidates retorna recomendação quando discovery retorna 0
 * 10. erros do processing são propagados em result.errors
 * 11. sem evidenceText → não entra como usefulResult
 * 12. sem price → não entra como usefulResult
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const { runCatalogFirstSupplierSearch } = await import(
  '../suppliers/v2/searchEngine/catalogSearch/catalogSearchOrchestrator.js'
);
const { closePool } = await import('../db/client.js');

import type { Supplier } from '../services/supplierService.js';
import type {
  SupplierProductCatalogService,
  SupplierProductCandidate,
  SupplierProductMatch,
} from '../suppliers/v2/catalog/index.js';
import type {
  CatalogDiscoveryInput,
  CatalogDiscoveryResult,
} from '../suppliers/v2/searchEngine/catalogDiscovery/index.js';
import type {
  CatalogProcessingInput,
  CatalogProcessingResult,
  ProcessedCandidate,
} from '../suppliers/v2/searchEngine/catalogProcessing/index.js';

after(async () => {
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
    urlHash: 'abc'.repeat(21) + 'a',
    source: 'search_page',
    status: 'validated',
    productName: 'SSD Kingston 1TB NVMe',
    brand: 'Kingston',
    sku: null,
    price: 299.9,
    currency: 'BRL',
    priceBrl: 299.9,
    freight: 0,
    freightStatus: 'free_confirmed',
    totalBrl: 299.9,
    matchScore: 85,
    confidence: 90,
    evidenceText: 'SSD Kingston 1TB NVMe — R$ 299,90 frete grátis',
    priceEvidenceText: null,
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
    matchScore: 85,
    confidence: 90,
    reason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function makeDiscoveryResult(
  over: Partial<CatalogDiscoveryResult> = {},
): CatalogDiscoveryResult {
  return {
    supplierId: SUPPLIER_ID,
    query: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    reusableMatches: 0,
    candidatesFound: 3,
    candidatesSaved: 3,
    candidatesRejected: 0,
    sourceBreakdown: [
      {
        source: 'search_page',
        runId: 'run-1',
        status: 'completed',
        fetchStatus: 'success',
        candidatesFound: 3,
        candidatesSaved: 3,
        candidatesRejected: 0,
      },
    ],
    discoveryRunIds: ['run-1'],
    attempts: [],
    errors: [],
    ...over,
  };
}

function makeProcessingResult(
  processed: ProcessedCandidate[] = [],
  over: Partial<CatalogProcessingResult> = {},
): CatalogProcessingResult {
  return {
    supplierId: SUPPLIER_ID,
    query: 'ssd 1tb nvme',
    normalizedQuery: 'ssd 1tb nvme',
    status: 'completed',
    candidatesProcessed: processed.length,
    candidatesUpdated: processed.length,
    matchesCreated: processed.filter((p) => p.matchCreated && p.matchStatus !== 'rejected')
      .length,
    matchesRejected: processed.filter((p) => p.matchStatus === 'rejected').length,
    statusBreakdown: {},
    processed,
    attempts: [],
    errors: [],
    ...over,
  };
}

function makeProcessed(over: Partial<ProcessedCandidate> = {}): ProcessedCandidate {
  return {
    candidateId: CANDIDATE_ID,
    productUrl: 'https://www.kabum.com.br/produto/111',
    status: 'validated',
    candidateStatus: 'validated',
    matchScore: 85,
    matchStatus: 'confirmed',
    updated: true,
    matchCreated: true,
    ...over,
  };
}

function makeCatalogService(opts: {
  matches?: SupplierProductMatch[];
  candidates?: SupplierProductCandidate[];
}): SupplierProductCatalogService {
  return {
    upsertCandidate: async () => makeCandidate(),
    listCandidatesByQuery: async () => opts.candidates ?? [],
    listReusableMatches: async () => opts.matches ?? [],
    listMatchesByQuery: async () => [],
    listDiscoveryRunsByQuery: async () => [],
    updateCandidateExtraction: async () => makeCandidate(),
    createDiscoveryRun: async () => ({
      id: 'run-id',
      supplierId: SUPPLIER_ID,
      queryText: '',
      normalizedQuery: '',
      source: 'search_page' as const,
      status: 'completed' as const,
      candidatesFound: 0,
      candidatesSaved: 0,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }),
    finishDiscoveryRun: async () => ({
      id: 'run-id',
      supplierId: SUPPLIER_ID,
      queryText: '',
      normalizedQuery: '',
      source: 'search_page' as const,
      status: 'completed' as const,
      candidatesFound: 0,
      candidatesSaved: 0,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }),
    createOrUpdateMatch: async () => makeMatch(),
  };
}

describe('runCatalogFirstSupplierSearch', () => {
  it('usa matches reutilizáveis quando existem → strategy=reused_matches', async () => {
    const match = makeMatch();
    const candidate = makeCandidate();
    const catalogService = makeCatalogService({
      matches: [match],
      candidates: [candidate],
    });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> => {
      throw new Error('discovery não deveria ser chamado');
    };
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed()]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(result.strategy, 'reused_matches');
    assert.equal(result.reusedMatchesCount, 1);
    assert.equal(result.errors.length, 0);
  });

  it('NÃO roda discovery quando há matches reutilizáveis', async () => {
    let discoveryCalled = false;
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [makeCandidate()],
    });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> => {
      discoveryCalled = true;
      return makeDiscoveryResult();
    };
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed()]);

    await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(discoveryCalled, false, 'discovery não deve ser chamado');
  });

  it('roda discovery quando não há matches → strategy=discovered_then_processed', async () => {
    let discoveryCalled = false;
    const catalogService = makeCatalogService({
      matches: [],
      candidates: [makeCandidate()],
    });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> => {
      discoveryCalled = true;
      return makeDiscoveryResult();
    };
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed()]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(discoveryCalled, true, 'discovery deve ser chamado');
    assert.equal(result.strategy, 'discovered_then_processed');
  });

  it('roda processing depois do discovery', async () => {
    let processCalled = false;
    const catalogService = makeCatalogService({
      matches: [],
      candidates: [makeCandidate()],
    });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> =>
      makeDiscoveryResult();
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> => {
      processCalled = true;
      return makeProcessingResult([makeProcessed()]);
    };

    await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(processCalled, true, 'processing deve ser chamado após discovery');
  });

  it('validated entra como usefulResult', async () => {
    const candidate = makeCandidate({ status: 'validated' });
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [candidate],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed({ candidateStatus: 'validated' })]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.usefulResults.length, 1);
    assert.equal(result.usefulResults[0]!.status, 'validated');
    assert.equal(result.status, 'completed');
  });

  it('partial entra como usefulResult e frete permanece null', async () => {
    const candidate = makeCandidate({
      status: 'partial',
      freight: null,
      freightStatus: 'not_available',
      totalBrl: null,
    });
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [candidate],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([
        makeProcessed({
          status: 'partial',
          candidateStatus: 'partial',
          matchStatus: 'pending',
        }),
      ]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.usefulResults.length, 1);
    assert.equal(result.usefulResults[0]!.status, 'partial');
    assert.equal(result.usefulResults[0]!.freight, null, 'frete desconhecido nunca vira 0');
    assert.equal(result.usefulResults[0]!.totalBrl, null);
  });

  it('product_mismatch fica em failures', async () => {
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [makeCandidate({ status: 'product_mismatch' })],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([
        makeProcessed({
          status: 'product_mismatch',
          candidateStatus: 'product_mismatch',
          matchStatus: 'rejected',
          matchCreated: true,
        }),
      ]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.usefulResults.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]!.status, 'product_mismatch');
    assert.equal(result.status, 'no_matches');
  });

  it('blocked fica em failures', async () => {
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [makeCandidate({ status: 'blocked' })],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([
        makeProcessed({
          status: 'blocked',
          candidateStatus: 'blocked',
          matchScore: null,
          matchStatus: null,
          matchCreated: false,
        }),
      ]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]!.status, 'blocked');
  });

  it('no_candidates retorna recomendação quando discovery retorna 0 candidatos', async () => {
    const catalogService = makeCatalogService({ matches: [], candidates: [] });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> =>
      makeDiscoveryResult({ candidatesSaved: 0, candidatesFound: 0, sourceBreakdown: [] });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> => {
      throw new Error('processing não deveria ser chamado');
    };

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'produto inexistente' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(result.status, 'no_candidates');
    assert.ok(result.recommendation, 'recommendation deve estar presente');
    assert.ok(result.recommendation!.length > 0);
  });

  it('erros do processing são propagados em result.errors', async () => {
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [makeCandidate()],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([], {
        candidatesProcessed: 1,
        errors: [{ candidateId: CANDIDATE_ID, message: 'falha simulada de banco' }],
        status: 'partial',
      });

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.ok(result.errors.some((e) => e.message.includes('falha simulada')));
  });

  it('sem evidenceText → candidato não entra como usefulResult', async () => {
    const candidate = makeCandidate({ evidenceText: null });
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [candidate],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed({ candidateStatus: 'validated' })]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.usefulResults.length, 0, 'sem evidência não entra como útil');
  });

  it('sem price → candidato não entra como usefulResult', async () => {
    const candidate = makeCandidate({ price: null });
    const catalogService = makeCatalogService({
      matches: [makeMatch()],
      candidates: [candidate],
    });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed({ candidateStatus: 'validated' })]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      {
        catalogService,
        runCatalogDiscoveryFn: async () => {
          throw new Error('não chamado');
        },
        processCatalogCandidatesFn: processFn,
      },
    );

    assert.equal(result.usefulResults.length, 0, 'sem preço não entra como útil');
  });

  it('diagnostics refletem fonte do discovery', async () => {
    const catalogService = makeCatalogService({
      matches: [],
      candidates: [makeCandidate()],
    });
    const discoveryFn = async (_: CatalogDiscoveryInput): Promise<CatalogDiscoveryResult> =>
      makeDiscoveryResult({
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
      });
    const processFn = async (
      _: CatalogProcessingInput,
    ): Promise<CatalogProcessingResult> =>
      makeProcessingResult([makeProcessed()]);

    const result = await runCatalogFirstSupplierSearch(
      { supplier: makeSupplier(), query: 'ssd 1tb nvme' },
      { catalogService, runCatalogDiscoveryFn: discoveryFn, processCatalogCandidatesFn: processFn },
    );

    assert.equal(result.diagnostics.candidatesDiscoveredBySource['firecrawl_search'], 2);
  });
});

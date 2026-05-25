/**
 * Etapa 16 — Catalog Processing (raspar candidatos + criar matches).
 *
 * Providers mockados, catalogService fake. Nenhuma rede real, nenhuma IA.
 *
 * Cobre:
 *  - no_candidates quando catálogo vazio (+ recomendação)
 *  - processa candidato e cria match confirmed (score alto)
 *  - processa candidato e cria match pending (score médio)
 *  - rejeita candidato sem preço (price_not_found, sem match)
 *  - product_mismatch → match rejected
 *  - partial (sem frete) cria match útil e frete não vira 0
 *  - updateCandidateExtraction é chamado
 *  - createOrUpdateMatch é chamado
 *  - HTML bruto não é salvo no candidato
 *  - diagnostics não vazam API key / não citam IA
 *  - Firecrawl mockado funciona (provider type 'firecrawl')
 *  - decideMatch / mapResultToCandidateUpdate (funções puras)
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const { processCatalogCandidates } = await import(
  '../suppliers/v2/searchEngine/catalogProcessing/catalogProcessingOrchestrator.js'
);
const { decideMatch } = await import(
  '../suppliers/v2/searchEngine/catalogProcessing/catalogMatchBuilder.js'
);
const { mapResultToCandidateUpdate } = await import(
  '../suppliers/v2/searchEngine/catalogProcessing/catalogProcessingMapper.js'
);
const { buildValidatedResult, buildStatusResult } = await import(
  '../suppliers/v2/recipeRunner/resultBuilder.js'
);
const { closePool } = await import('../db/client.js');

import type { Supplier } from '../services/supplierService.js';
import type {
  SupplierProductCatalogService,
  SupplierProductCandidate,
  UpdateCandidateExtractionInput,
  CreateOrUpdateMatchInput,
} from '../suppliers/v2/catalog/index.js';
import type {
  FetchProvider,
  FetchProviderResult,
  FetchProviderStatus,
} from '../suppliers/v2/searchEngine/index.js';

after(async () => {
  await closePool().catch(() => {});
});

// ─── Fixtures HTML (reaproveitadas do pipeline próprio) ──────────────────────

const PRODUCT_VALIDATED_FREE = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Notebook Dell Inspiron 15 i5 16GB",
  "offers": { "@type": "Offer", "price": "4599.90", "priceCurrency": "BRL" } }
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1><p>R$ 4.599,90</p>
<span>frete grátis para todo o Brasil</span></body></html>`;

const PRODUCT_VALIDATED_NO_FREIGHT = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Notebook Dell Inspiron 15 i5 16GB",
  "offers": { "@type": "Offer", "price": "4599.90", "priceCurrency": "BRL" } }
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1><p>R$ 4.599,90</p></body></html>`;

const PRODUCT_MISMATCH = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Geladeira Brastemp Frost Free 400L",
  "offers": { "@type": "Offer", "price": "3299.00", "priceCurrency": "BRL" } }
</script>
</head><body><h1>Geladeira Brastemp</h1></body></html>`;

const PRODUCT_NO_PRICE = `
<html><head>
<script type="application/ld+json">
{ "@type": "Product", "name": "Notebook Dell Inspiron 15 i5 16GB" }
</script>
</head><body><h1>Notebook Dell Inspiron 15</h1></body></html>`;

const PRODUCT_URL = 'https://loja.test/produto/notebook-dell-i5';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Loja Teste',
    site: 'https://loja.test',
    search_url_template: 'https://loja.test/busca?q={q}',
    currency: 'BRL',
    country: 'BR',
    type: 'store',
    active: true,
    extraction_mode: 'auto',
    extractor_config: {},
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as Supplier;
}

function makeCandidate(over: Partial<SupplierProductCandidate> = {}): SupplierProductCandidate {
  return {
    id: 'cand-1',
    supplierId: 's1',
    queryText: 'notebook dell',
    normalizedQuery: 'notebook dell',
    productUrl: PRODUCT_URL,
    canonicalUrl: null,
    urlHash: 'hash-1',
    source: 'firecrawl_search',
    status: 'candidate',
    productName: null,
    brand: null,
    sku: null,
    price: null,
    currency: null,
    priceBrl: null,
    freight: null,
    freightStatus: null,
    totalBrl: null,
    matchScore: 80,
    confidence: null,
    evidenceText: null,
    priceEvidenceText: null,
    lastCheckedAt: null,
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

interface CatalogCalls {
  listed: number;
  updates: UpdateCandidateExtractionInput[];
  matches: CreateOrUpdateMatchInput[];
}

function makeFakeCatalog(candidates: SupplierProductCandidate[]): {
  service: SupplierProductCatalogService;
  calls: CatalogCalls;
} {
  const calls: CatalogCalls = { listed: 0, updates: [], matches: [] };
  const service: SupplierProductCatalogService = {
    async listCandidatesByQuery() {
      calls.listed += 1;
      return candidates;
    },
    async upsertCandidate() {
      return {} as never;
    },
    async listReusableMatches() {
      return [];
    },
    async updateCandidateExtraction(input) {
      calls.updates.push(input);
      return { id: input.candidateId } as never;
    },
    async createDiscoveryRun() {
      return {} as never;
    },
    async finishDiscoveryRun() {
      return {} as never;
    },
    async createOrUpdateMatch(input) {
      calls.matches.push(input);
      return { id: 'match-1' } as never;
    },
  };
  return { service, calls };
}

function fakeProvider(
  handler: (url: string) => Partial<FetchProviderResult> & { status: FetchProviderStatus },
  type: FetchProvider['type'] = 'native',
): { provider: FetchProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: FetchProvider = {
    name: type === 'firecrawl' ? 'firecrawl' : 'mock_native',
    type,
    enabled: true,
    async fetchPage({ url }) {
      calls.push(url);
      return { url, elapsedMs: 1, ...handler(url) };
    },
  };
  return { provider, calls };
}

// ─── no_candidates ─────────────────────────────────────────────────────────

describe('processCatalogCandidates — no_candidates', () => {
  it('catálogo vazio → status no_candidates + recomendação', async () => {
    const { service, calls } = makeFakeCatalog([]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: '' }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.status, 'no_candidates');
    assert.equal(result.candidatesProcessed, 0);
    assert.ok(result.recommendation?.includes('discover-catalog'));
    assert.equal(calls.listed, 1);
  });
});

// ─── confirmed / pending ─────────────────────────────────────────────────────

describe('processCatalogCandidates — cria matches', () => {
  it('match confirmed quando score alto (validated)', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.candidatesProcessed, 1);
    assert.equal(result.candidatesUpdated, 1);
    assert.equal(result.matchesCreated, 1);
    assert.equal(result.matchesRejected, 0);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.updates[0]!.status, 'validated');
    assert.equal(calls.matches.length, 1);
    assert.equal(calls.matches[0]!.matchStatus, 'confirmed');
    assert.equal(result.statusBreakdown['validated'], 1);
  });

  it('match pending quando score médio', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate({ normalizedQuery: 'notebook dell xps' })]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    const result = await processCatalogCandidates(
      // query com token extra (xps) que não bate → score médio (~67)
      { supplier: makeSupplier(), query: 'notebook dell xps', minMatchScore: 50 },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.matchesCreated, 1);
    assert.equal(calls.matches[0]!.matchStatus, 'pending');
  });
});

// ─── rejeições ───────────────────────────────────────────────────────────────

describe('processCatalogCandidates — rejeições', () => {
  it('sem preço → price_not_found, sem match', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_NO_PRICE }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.matchesCreated, 0);
    assert.equal(result.matchesRejected, 0);
    assert.equal(calls.updates[0]!.status, 'price_not_found');
    assert.equal(calls.matches.length, 0);
    assert.equal(result.statusBreakdown['price_not_found'], 1);
  });

  it('product_mismatch → match rejected', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_MISMATCH }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.matchesRejected, 1);
    assert.equal(result.matchesCreated, 0);
    assert.equal(calls.updates[0]!.status, 'product_mismatch');
    assert.equal(calls.matches[0]!.matchStatus, 'rejected');
  });
});

// ─── partial / frete ─────────────────────────────────────────────────────────

describe('processCatalogCandidates — partial e frete', () => {
  it('sem frete → candidato partial, match útil, frete NUNCA vira 0', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_VALIDATED_NO_FREIGHT }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.matchesCreated, 1);
    assert.equal(calls.updates[0]!.status, 'partial');
    assert.equal(calls.updates[0]!.freightStatus, 'not_available');
    // frete desconhecido permanece null — nunca 0
    assert.equal(calls.updates[0]!.freight, null);
    assert.notEqual(calls.updates[0]!.freight, 0);
    assert.equal(result.statusBreakdown['partial'], 1);
  });
});

// ─── segurança: HTML / key / IA ──────────────────────────────────────────────

describe('processCatalogCandidates — segurança', () => {
  it('não salva HTML bruto no candidato', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    const ev = calls.updates[0]!.evidenceText ?? '';
    assert.ok(!ev.includes('<html'), 'evidenceText não pode conter <html');
    assert.ok(!ev.includes('</body>'), 'evidenceText não pode conter HTML bruto');
  });

  it('diagnostics não vazam API key nem citam IA/Gemini', async () => {
    const { service } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    const serialized = JSON.stringify(result).toLowerCase();
    assert.ok(!serialized.includes('fc-'));
    assert.ok(!serialized.includes('gemini'));
    assert.ok(!serialized.includes('openai'));
    assert.ok(!serialized.includes('authorization'));
  });

  it('Firecrawl mockado (provider type firecrawl) funciona', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider, calls: fetchCalls } = fakeProvider(
      () => ({ status: 'success', html: PRODUCT_VALIDATED_FREE }),
      'firecrawl',
    );

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell', providerPolicy: { firecrawlEnabled: true } },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.matchesCreated, 1);
    assert.equal(calls.matches[0]!.matchStatus, 'confirmed');
    assert.ok(fetchCalls.includes(PRODUCT_URL));
  });

  it('candidato bloqueado → status blocked, sem match', async () => {
    const { service, calls } = makeFakeCatalog([makeCandidate()]);
    const { provider } = fakeProvider(() => ({ status: 'blocked' }));

    const result = await processCatalogCandidates(
      { supplier: makeSupplier(), query: 'notebook dell' },
      { catalogService: service, providers: [provider] },
    );

    assert.equal(result.statusBreakdown['blocked'], 1);
    assert.equal(calls.matches.length, 0);
    assert.equal(calls.updates[0]?.status, 'blocked');
  });
});

// ─── funções puras ───────────────────────────────────────────────────────────

describe('decideMatch (pura)', () => {
  const opts = { minMatchScore: 50, trustedScore: 75 };

  it('validated + frete confirmado + score alto → confirmed', () => {
    const r = buildValidatedResult({
      productName: 'Notebook Dell', price: 100, currency: 'BRL',
      productUrl: PRODUCT_URL, evidenceText: 'R$ 100', sourceUrl: PRODUCT_URL,
      strategy: 'json_ld', matchScore: 90, confidence: 80,
      freight: { state: 'free_confirmed', value: 0, evidence: 'grátis' },
    });
    const d = decideMatch(r, opts);
    assert.equal(d.candidateStatus, 'validated');
    assert.equal(d.matchStatus, 'confirmed');
    assert.equal(d.createMatch, true);
  });

  it('validated + frete desconhecido → candidato partial', () => {
    const r = buildValidatedResult({
      productName: 'Notebook Dell', price: 100, currency: 'BRL',
      productUrl: PRODUCT_URL, evidenceText: 'R$ 100', sourceUrl: PRODUCT_URL,
      strategy: 'json_ld', matchScore: 90, confidence: 80,
      freight: { state: 'not_available', value: null, evidence: null },
    });
    const d = decideMatch(r, opts);
    assert.equal(d.candidateStatus, 'partial');
    assert.equal(d.matchStatus, 'confirmed');
  });

  it('product_mismatch → rejected', () => {
    const r = buildStatusResult('product_mismatch', 'produto diferente');
    const d = decideMatch(r, opts);
    assert.equal(d.candidateStatus, 'product_mismatch');
    assert.equal(d.matchStatus, 'rejected');
    assert.equal(d.createMatch, true);
  });

  it('price_not_found → sem match', () => {
    const r = buildStatusResult('price_not_found', 'sem preço');
    const d = decideMatch(r, opts);
    assert.equal(d.candidateStatus, 'price_not_found');
    assert.equal(d.createMatch, false);
  });
});

describe('mapResultToCandidateUpdate (pura)', () => {
  it('frete desconhecido vira null (nunca 0); BRL ecoa price_brl', () => {
    const r = buildValidatedResult({
      productName: 'Notebook', price: 200, currency: 'BRL',
      productUrl: PRODUCT_URL, evidenceText: 'R$ 200', sourceUrl: PRODUCT_URL,
      strategy: 'json_ld', matchScore: 90, confidence: 70,
      freight: { state: 'not_available', value: null, evidence: null },
    });
    const d = decideMatch(r, { minMatchScore: 50, trustedScore: 75 });
    const upd = mapResultToCandidateUpdate('cand-1', r, d);
    assert.equal(upd.freight, null);
    assert.equal(upd.freightStatus, 'not_available');
    assert.equal(upd.priceBrl, 200);
    assert.equal(upd.totalBrl, null); // sem frete confirmado, sem total
    assert.equal(upd.status, 'partial');
  });

  it('moeda não-BRL não ecoa price_brl (sem cotação)', () => {
    const r = buildValidatedResult({
      productName: 'SSD', price: 50, currency: 'USD',
      productUrl: PRODUCT_URL, evidenceText: 'US$ 50', sourceUrl: PRODUCT_URL,
      strategy: 'json_ld', matchScore: 90, confidence: 70,
      freight: { state: 'free_confirmed', value: 0, evidence: 'free' },
    });
    const d = decideMatch(r, { minMatchScore: 50, trustedScore: 75 });
    const upd = mapResultToCandidateUpdate('cand-1', r, d);
    assert.equal(upd.priceBrl, null);
    assert.equal(upd.totalBrl, null);
    assert.equal(upd.currency, 'USD');
  });
});

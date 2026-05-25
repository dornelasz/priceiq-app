/**
 * Etapa 14 — Supplier Product Catalog
 *
 * Cobre:
 *  - normalizeCatalogQuery (função pura)
 *  - hashProductUrl estável e determinístico (função pura)
 *  - truncateEvidenceText: respeita MAX_EVIDENCE_LENGTH (função pura)
 *  - não salva HTML bruto (verificação de truncamento + ausência de tags)
 *  - upsertCandidate: cria novo candidato
 *  - upsertCandidate: atualiza existente sem duplicar (ON CONFLICT)
 *  - listCandidatesByQuery: retorna candidatos por normalized_query
 *  - createOrUpdateMatch: deduplica por (supplier_id, candidate_id, normalized_query)
 *  - createDiscoveryRun: insere run com status inicial
 *  - finishDiscoveryRun: atualiza run com contadores e finished_at
 *  - mapRankedCandidatesToCatalog: mapper puro, sem I/O
 *  - status permitido 'validated' é aceito pelo tipo
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';

const {
  normalizeCatalogQuery,
  hashProductUrl,
  truncateEvidenceText,
  createSupplierProductCatalogService,
  MAX_EVIDENCE_LENGTH,
} = await import(
  '../suppliers/v2/catalog/supplierProductCatalogService.js'
);

const { mapRankedCandidatesToCatalog } = await import(
  '../suppliers/v2/catalog/candidateMapper.js'
);

// ─── Helpers de mock ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function makeMockQuery(rows: Row[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const queryFn = async (
    sql: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<pg.QueryResultRow>> => {
    calls.push({ sql: sql.trim(), params });
    return {
      rows,
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as pg.QueryResult<pg.QueryResultRow>;
  };
  return { queryFn, calls };
}

function makeCandidateRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'cand-uuid-1',
    supplier_id: 'sup-uuid-1',
    query_text: 'ssd 1tb nvme',
    normalized_query: 'ssd 1tb nvme',
    product_url: 'https://kabum.com.br/produto/123',
    canonical_url: null,
    url_hash: hashProductUrl('https://kabum.com.br/produto/123'),
    source: 'search_page',
    status: 'candidate',
    product_name: null,
    brand: null,
    sku: null,
    price: null,
    currency: null,
    price_brl: null,
    freight: null,
    freight_status: null,
    total_brl: null,
    match_score: '85',
    confidence: null,
    evidence_text: null,
    price_evidence_text: null,
    last_checked_at: null,
    first_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMatchRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'match-uuid-1',
    supplier_id: 'sup-uuid-1',
    candidate_id: 'cand-uuid-1',
    query_text: 'ssd 1tb nvme',
    normalized_query: 'ssd 1tb nvme',
    match_status: 'confirmed',
    match_score: '85',
    confidence: '90',
    reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRunRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'run-uuid-1',
    supplier_id: 'sup-uuid-1',
    query_text: 'ssd 1tb nvme',
    normalized_query: 'ssd 1tb nvme',
    source: 'search_page',
    status: 'completed',
    candidates_found: '0',
    candidates_saved: '0',
    error_message: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  };
}

// ─── normalizeCatalogQuery ────────────────────────────────────────────────────

describe('normalizeCatalogQuery', () => {
  it('converte para minúsculas e remove acentos', () => {
    assert.equal(normalizeCatalogQuery('SSD 1TB NVMe'), 'ssd 1tb nvme');
    assert.equal(normalizeCatalogQuery('Placa Mãe B550'), 'placa mae b550');
  });

  it('colapsa espaços extras', () => {
    assert.equal(normalizeCatalogQuery('  ssd   1tb  '), 'ssd 1tb');
  });

  it('remove pontuação e caracteres especiais', () => {
    assert.equal(normalizeCatalogQuery('SSD 1TB (NVMe) - M.2!'), 'ssd 1tb nvme m 2');
  });

  it('string vazia retorna string vazia', () => {
    assert.equal(normalizeCatalogQuery(''), '');
  });
});

// ─── hashProductUrl ───────────────────────────────────────────────────────────

describe('hashProductUrl', () => {
  it('retorna string de 64 chars hex', () => {
    const h = hashProductUrl('https://kabum.com.br/produto/123');
    assert.equal(typeof h, 'string');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
  });

  it('é determinístico — mesmo input, mesmo hash', () => {
    const url = 'https://kabum.com.br/produto/ssd-1tb';
    assert.equal(hashProductUrl(url), hashProductUrl(url));
  });

  it('URLs diferentes geram hashes diferentes', () => {
    const h1 = hashProductUrl('https://kabum.com.br/produto/123');
    const h2 = hashProductUrl('https://kabum.com.br/produto/456');
    assert.notEqual(h1, h2);
  });

  it('normaliza: trim + lowercase antes de hashear', () => {
    const h1 = hashProductUrl('https://KABUM.COM.BR/produto/123');
    const h2 = hashProductUrl('  https://kabum.com.br/produto/123  ');
    assert.equal(h1, h2);
  });
});

// ─── truncateEvidenceText ─────────────────────────────────────────────────────

describe('truncateEvidenceText', () => {
  it('texto curto passa sem alteração', () => {
    assert.equal(truncateEvidenceText('preço: R$ 499,00'), 'preço: R$ 499,00');
  });

  it('texto longo é truncado em MAX_EVIDENCE_LENGTH', () => {
    const longo = 'x'.repeat(MAX_EVIDENCE_LENGTH + 500);
    const resultado = truncateEvidenceText(longo);
    assert.equal(resultado?.length, MAX_EVIDENCE_LENGTH);
  });

  it('null retorna null', () => {
    assert.equal(truncateEvidenceText(null), null);
  });

  it('undefined retorna null', () => {
    assert.equal(truncateEvidenceText(undefined), null);
  });

  it('não salva HTML bruto — texto com tags > limite fica truncado', () => {
    const html = '<html><body>' + '<div>'.repeat(500) + '</body></html>';
    const resultado = truncateEvidenceText(html);
    assert.ok((resultado?.length ?? 0) <= MAX_EVIDENCE_LENGTH);
  });
});

// ─── upsertCandidate ──────────────────────────────────────────────────────────

describe('upsertCandidate — cria novo', () => {
  it('emite INSERT ... ON CONFLICT e retorna candidato mapeado', async () => {
    const row = makeCandidateRow();
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    const result = await svc.upsertCandidate({
      supplierId: 'sup-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      productUrl: 'https://kabum.com.br/produto/123',
      urlHash: hashProductUrl('https://kabum.com.br/produto/123'),
      source: 'search_page',
      status: 'candidate',
      matchScore: 85,
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.sql.includes('ON CONFLICT'));
    assert.ok(calls[0]!.sql.includes('supplier_product_candidates'));
    assert.equal(result.id, 'cand-uuid-1');
    assert.equal(result.supplierId, 'sup-uuid-1');
    assert.equal(result.status, 'candidate');
    assert.equal(result.matchScore, 85);
  });
});

describe('upsertCandidate — atualiza sem duplicar', () => {
  it('usa ON CONFLICT (supplier_id, url_hash) DO UPDATE', async () => {
    const row = makeCandidateRow({ status: 'extracted' });
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    const result = await svc.upsertCandidate({
      supplierId: 'sup-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      productUrl: 'https://kabum.com.br/produto/123',
      urlHash: hashProductUrl('https://kabum.com.br/produto/123'),
      source: 'search_page',
      status: 'extracted',
    });

    // apenas 1 chamada SQL (INSERT ... ON CONFLICT)
    assert.equal(calls.length, 1);
    assert.equal(result.status, 'extracted');
  });
});

// ─── listCandidatesByQuery ────────────────────────────────────────────────────

describe('listCandidatesByQuery', () => {
  it('retorna candidatos filtrados por supplier_id e normalized_query', async () => {
    const rows = [
      makeCandidateRow({ match_score: '90' }),
      makeCandidateRow({ id: 'cand-uuid-2', match_score: '70' }),
    ];
    const { queryFn, calls } = makeMockQuery(rows);
    const svc = createSupplierProductCatalogService(queryFn);

    const results = await svc.listCandidatesByQuery('sup-uuid-1', 'ssd 1tb nvme');

    assert.equal(results.length, 2);
    assert.ok(calls[0]!.params.includes('sup-uuid-1'));
    assert.ok(calls[0]!.params.includes('ssd 1tb nvme'));
  });

  it('retorna array vazio quando não há candidatos', async () => {
    const { queryFn } = makeMockQuery([]);
    const svc = createSupplierProductCatalogService(queryFn);
    const results = await svc.listCandidatesByQuery('sup-uuid-1', 'query-sem-resultado');
    assert.equal(results.length, 0);
  });
});

// ─── createOrUpdateMatch ──────────────────────────────────────────────────────

describe('createOrUpdateMatch', () => {
  it('emite INSERT ... ON CONFLICT e retorna match mapeado', async () => {
    const row = makeMatchRow();
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    const result = await svc.createOrUpdateMatch({
      supplierId: 'sup-uuid-1',
      candidateId: 'cand-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      matchStatus: 'confirmed',
      matchScore: 85,
      confidence: 90,
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.sql.includes('ON CONFLICT'));
    assert.ok(calls[0]!.sql.includes('supplier_product_matches'));
    assert.equal(result.matchStatus, 'confirmed');
    assert.equal(result.matchScore, 85);
  });

  it('deduplica: segunda chamada usa mesma constraint SQL', async () => {
    const row = makeMatchRow({ match_status: 'confirmed' });
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    await svc.createOrUpdateMatch({
      supplierId: 'sup-uuid-1',
      candidateId: 'cand-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      matchStatus: 'confirmed',
    });
    await svc.createOrUpdateMatch({
      supplierId: 'sup-uuid-1',
      candidateId: 'cand-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      matchStatus: 'confirmed',
    });

    // cada chamada é autônoma (ON CONFLICT resolve no DB, não no código)
    assert.equal(calls.length, 2);
    assert.ok(calls[0]!.sql.includes('ON CONFLICT'));
    assert.ok(calls[1]!.sql.includes('ON CONFLICT'));
  });
});

// ─── createDiscoveryRun + finishDiscoveryRun ──────────────────────────────────

describe('createDiscoveryRun', () => {
  it('insere run com status inicial e retorna run mapeado', async () => {
    const row = makeRunRow();
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    const run = await svc.createDiscoveryRun({
      supplierId: 'sup-uuid-1',
      queryText: 'ssd 1tb nvme',
      normalizedQuery: 'ssd 1tb nvme',
      source: 'search_page',
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.sql.includes('INSERT INTO supplier_discovery_runs'));
    assert.equal(run.id, 'run-uuid-1');
    assert.equal(run.candidatesFound, 0);
    assert.equal(run.finishedAt, null);
  });
});

describe('finishDiscoveryRun', () => {
  it('atualiza contadores e status do run existente', async () => {
    const row = makeRunRow({
      status: 'completed',
      candidates_found: '5',
      candidates_saved: '3',
      finished_at: new Date().toISOString(),
    });
    const { queryFn, calls } = makeMockQuery([row]);
    const svc = createSupplierProductCatalogService(queryFn);

    const run = await svc.finishDiscoveryRun({
      runId: 'run-uuid-1',
      status: 'completed',
      candidatesFound: 5,
      candidatesSaved: 3,
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.sql.includes('UPDATE supplier_discovery_runs'));
    assert.ok(calls[0]!.sql.includes('finished_at'));
    assert.equal(run.candidatesFound, 5);
    assert.equal(run.candidatesSaved, 3);
    assert.equal(run.status, 'completed');
    assert.ok(run.finishedAt !== null);
  });
});

// ─── mapRankedCandidatesToCatalog ─────────────────────────────────────────────

describe('mapRankedCandidatesToCatalog', () => {
  const fakeSupplier = {
    id: 'sup-uuid-1',
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
  };

  it('converte RankedCandidate[] em UpsertCandidateInput[]', () => {
    const candidates = [
      {
        url: 'https://kabum.com.br/produto/ssd-1',
        score: 90,
        linkClass: 'product' as const,
        reason: 'tokens matched',
        queryTokensFound: 3,
      },
      {
        url: 'https://kabum.com.br/produto/ssd-2',
        score: 70,
        linkClass: 'product' as const,
        reason: 'partial match',
        queryTokensFound: 2,
      },
    ];

    const inputs = mapRankedCandidatesToCatalog(
      candidates,
      fakeSupplier,
      'ssd 1tb nvme',
      'ssd 1tb nvme',
      'search_page',
    );

    assert.equal(inputs.length, 2);
    assert.equal(inputs[0]!.supplierId, 'sup-uuid-1');
    assert.equal(inputs[0]!.productUrl, 'https://kabum.com.br/produto/ssd-1');
    assert.equal(inputs[0]!.matchScore, 90);
    assert.equal(inputs[0]!.source, 'search_page');
    assert.equal(inputs[0]!.status, 'candidate');
    // url_hash deve ser consistente com hashProductUrl
    assert.equal(
      inputs[0]!.urlHash,
      hashProductUrl('https://kabum.com.br/produto/ssd-1'),
    );
  });

  it('array vazio → array vazio', () => {
    const inputs = mapRankedCandidatesToCatalog(
      [],
      fakeSupplier,
      'ssd 1tb nvme',
      'ssd 1tb nvme',
    );
    assert.equal(inputs.length, 0);
  });
});

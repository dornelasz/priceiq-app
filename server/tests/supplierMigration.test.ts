/**
 * Testes da Fase B — supplier_recipes + status de fornecedor.
 *
 * Como o projeto não tem infraestrutura de DB-em-teste, este suite cobre:
 *  1. Estrutura da migration SQL (assertions sobre o conteúdo do arquivo).
 *  2. Conversores puros do supplierService (recipeRowToApi, supplierRowToApi).
 *  3. Schema de criação de fornecedor (search_url_template opcional, status
 *     do sistema é stripado do input).
 *
 * Comportamentos que exigem banco real (backfill, CHECK constraints rejeitando
 * valores inválidos no INSERT, defaults aplicados em INSERTs sem as colunas)
 * NÃO são exercidos aqui — apenas a forma do SQL é validada. Esses cenários
 * são cobertos pela execução real da migration via `npm run db:migrate`.
 */
// Garante DATABASE_URL antes do supplierService importar db/client → config.
// Os imports estáticos abaixo são apenas para módulos puros (sem env). O
// supplierService entra por dynamic import após o env estar setado.
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { recipeRowToApi, supplierRowToApi } = await import(
  '../services/supplierService.js'
);
const { supplierCreateSchema } = await import('../lib/validators.js');
type SupplierRecipe = import('../suppliers/v2/index.js').SupplierRecipe;

// ─── Carrega o arquivo da migration ─────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  '..',
  'db',
  'migrations',
  '0004_supplier_recipes.sql',
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');
const sqlLower = sql.toLowerCase();

// ─── 1. Estrutura da migration ──────────────────────────────────────────

describe('Migration 0004 — suppliers: colunas de status', () => {
  it('adiciona certification_status com NOT NULL DEFAULT unconfigured', () => {
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS certification_status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'unconfigured'/i,
    );
  });

  it('adiciona setup_status com NOT NULL DEFAULT unconfigured', () => {
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS setup_status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'unconfigured'/i,
    );
  });

  it('adiciona auto_configured_at TIMESTAMPTZ NULL', () => {
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS auto_configured_at\s+TIMESTAMPTZ\s+NULL/i,
    );
  });

  it('adiciona CHECK constraint em certification_status com os 8 valores', () => {
    assert.ok(sqlLower.includes("suppliers_certification_status_check"));
    for (const v of [
      'unconfigured', 'auto_configuring', 'certified', 'needs_guided_setup',
      'blocked', 'requires_login', 'unsupported', 'failed',
    ]) {
      assert.ok(
        sql.includes(`'${v}'`),
        `valor ${v} faltando no CHECK de certification_status`,
      );
    }
  });

  it('adiciona CHECK constraint em setup_status', () => {
    assert.ok(sqlLower.includes('suppliers_setup_status_check'));
  });

  it('cria índices para os novos campos', () => {
    assert.match(sql, /idx_suppliers_certification_status/);
    assert.match(sql, /idx_suppliers_setup_status/);
  });
});

describe('Migration 0004 — tabela supplier_recipes', () => {
  it('cria a tabela supplier_recipes (idempotente)', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS supplier_recipes/i);
  });

  it('tem PRIMARY KEY UUID', () => {
    assert.match(sql, /id\s+UUID\s+PRIMARY KEY\s+DEFAULT\s+uuid_generate_v4\(\)/i);
  });

  it('tem FK supplier_id com ON DELETE CASCADE', () => {
    assert.match(
      sql,
      /supplier_id\s+UUID\s+NOT NULL\s+REFERENCES\s+suppliers\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('tem UNIQUE(supplier_id) — uma receita por fornecedor', () => {
    assert.match(sql, /UNIQUE\s*\(\s*supplier_id\s*\)/i);
  });

  it('tem todas as colunas exigidas pelo contrato V2', () => {
    const required = [
      'platform_detected', 'search_url_template', 'product_url_patterns',
      'extraction_strategy', 'title_selector', 'price_selector',
      'currency_selector', 'image_selector', 'availability_selector',
      'jsonld_enabled', 'json_paths', 'requires_js', 'requires_browser',
      'confidence', 'last_tested_at', 'last_success_at', 'last_error',
      'config_json', 'created_at', 'updated_at',
    ];
    for (const col of required) {
      assert.ok(sql.includes(col), `coluna ${col} faltando em supplier_recipes`);
    }
  });

  it('product_url_patterns é JSONB com default array vazio', () => {
    assert.match(sql, /product_url_patterns\s+JSONB\s+NOT NULL\s+DEFAULT\s+'\[\]'::jsonb/i);
  });

  it('CHECK status aceita os 8 valores de SupplierCertificationStatus', () => {
    assert.ok(sql.includes('supplier_recipes_status_check'));
  });

  it('CHECK extraction_strategy aceita NULL ou as 11 estratégias oficiais', () => {
    assert.ok(sql.includes('supplier_recipes_strategy_check'));
    for (const s of [
      'json_ld', 'schema_org', 'meta_tags', 'script_json', 'next_data',
      'dom', 'visual_heuristic', 'jina_fallback', 'playwright_fallback',
      'guided_selector', 'specialized_adapter',
    ]) {
      assert.ok(sql.includes(`'${s}'`), `strategy ${s} faltando no CHECK`);
    }
  });

  it('CHECK confidence aceita NULL ou 0..100', () => {
    assert.ok(sql.includes('supplier_recipes_confidence_check'));
    assert.match(sql, /confidence\s+IS NULL\s+OR\s+\(confidence\s*>=\s*0\s+AND\s+confidence\s*<=\s*100\)/i);
  });

  it('cria índices supplier_id_idx e status_idx', () => {
    assert.match(sql, /supplier_recipes_supplier_id_idx/);
    assert.match(sql, /supplier_recipes_status_idx/);
  });

  it('reusa o trigger set_updated_at()', () => {
    assert.match(sql, /trg_supplier_recipes_updated_at/);
    assert.match(sql, /EXECUTE FUNCTION set_updated_at\(\)/i);
  });
});

describe('Migration 0004 — backfill de receitas legacy', () => {
  it('faz INSERT INTO supplier_recipes a partir de suppliers', () => {
    assert.match(sql, /INSERT INTO supplier_recipes/i);
    assert.match(sql, /FROM suppliers/i);
  });

  it('só cria recipe para suppliers com search_url_template não vazio', () => {
    assert.match(sql, /search_url_template\s+IS NOT NULL/i);
    assert.match(sql, /search_url_template\s*<>\s*''/);
  });

  it('marca status="unconfigured" (NUNCA "certified" automaticamente)', () => {
    // O bloco de backfill insere 'unconfigured' como status.
    // Garantia adicional: não há 'certified' em INSERT.
    const insertSection = sql.split('INSERT INTO supplier_recipes')[1] ?? '';
    assert.ok(insertSection.includes("'unconfigured'"));
    assert.ok(
      !insertSection.includes("'certified'"),
      'backfill nunca deve marcar receita como certified',
    );
  });

  it('marca config_json com {"source":"legacy_search_url_template"}', () => {
    assert.match(sql, /legacy_search_url_template/);
  });

  it('é idempotente (ON CONFLICT DO NOTHING)', () => {
    assert.match(sql, /ON CONFLICT\s*\(\s*supplier_id\s*\)\s*DO NOTHING/i);
  });
});

describe('Migration 0004 — não destrutiva', () => {
  it('não dropa search_url_template antigo', () => {
    assert.ok(!sqlLower.includes('drop column'));
    assert.ok(!/alter\s+table\s+suppliers\s+drop/i.test(sqlLower));
  });

  it('não dropa nenhuma tabela existente', () => {
    assert.ok(!/drop\s+table\s+suppliers/i.test(sqlLower));
    assert.ok(!/drop\s+table\s+search_results/i.test(sqlLower));
    assert.ok(!/drop\s+table\s+searches/i.test(sqlLower));
  });
});

// ─── 2. Conversores puros do service ────────────────────────────────────

function makeRecipeRow(over: Record<string, unknown> = {}): Parameters<
  typeof recipeRowToApi
>[0] {
  const base = {
    id: 'rec-1',
    supplier_id: 'sup-1',
    status: 'unconfigured' as const,
    platform_detected: null,
    search_url_template: 'https://loja.com/busca?q={q}',
    product_url_patterns: [],
    extraction_strategy: null,
    title_selector: null,
    price_selector: null,
    currency_selector: null,
    image_selector: null,
    availability_selector: null,
    jsonld_enabled: false,
    json_paths: null,
    requires_js: false,
    requires_browser: false,
    confidence: null,
    last_tested_at: null,
    last_success_at: null,
    last_error: null,
    config_json: { source: 'legacy_search_url_template' },
    created_at: new Date('2026-05-22T12:00:00.000Z'),
    updated_at: new Date('2026-05-22T12:00:00.000Z'),
  };
  return { ...base, ...over } as Parameters<typeof recipeRowToApi>[0];
}

describe('recipeRowToApi — conversão snake_case → camelCase', () => {
  it('mapeia campos principais corretamente', () => {
    const r = recipeRowToApi(makeRecipeRow());
    assert.equal(r.supplierId, 'sup-1');
    assert.equal(r.status, 'unconfigured');
    assert.equal(r.searchUrlTemplate, 'https://loja.com/busca?q={q}');
    assert.deepEqual(r.productUrlPatterns, []);
    assert.equal(r.jsonLdEnabled, false);
    assert.equal(r.requiresJs, false);
    assert.equal(r.requiresBrowser, false);
  });

  it('confidence como string (NUMERIC do PG) é convertido para number', () => {
    const r = recipeRowToApi(makeRecipeRow({ confidence: '85.50' }));
    assert.equal(r.confidence, 85.5);
    assert.equal(typeof r.confidence, 'number');
  });

  it('confidence numérico passa direto', () => {
    const r = recipeRowToApi(makeRecipeRow({ confidence: 95 }));
    assert.equal(r.confidence, 95);
  });

  it('confidence null permanece null', () => {
    const r = recipeRowToApi(makeRecipeRow({ confidence: null }));
    assert.equal(r.confidence, null);
  });

  it('datas Date são convertidas para ISO string', () => {
    const r = recipeRowToApi(
      makeRecipeRow({
        last_tested_at: new Date('2026-05-22T15:00:00.000Z'),
        last_success_at: new Date('2026-05-22T14:00:00.000Z'),
      }),
    );
    assert.equal(r.lastTestedAt, '2026-05-22T15:00:00.000Z');
    assert.equal(r.lastSuccessAt, '2026-05-22T14:00:00.000Z');
  });

  it('datas null permanecem null', () => {
    const r = recipeRowToApi(makeRecipeRow());
    assert.equal(r.lastTestedAt, null);
    assert.equal(r.lastSuccessAt, null);
  });

  it('product_url_patterns vem como JSONB → array', () => {
    const r = recipeRowToApi(
      makeRecipeRow({ product_url_patterns: ['^https://loja\\.com/p/'] }),
    );
    assert.deepEqual(r.productUrlPatterns, ['^https://loja\\.com/p/']);
  });

  it('product_url_patterns ausente vira array vazio', () => {
    const r = recipeRowToApi(makeRecipeRow({ product_url_patterns: null }));
    assert.deepEqual(r.productUrlPatterns, []);
  });

  it('config_json é preservado como objeto', () => {
    const r = recipeRowToApi(
      makeRecipeRow({
        config_json: { source: 'legacy_search_url_template' },
      }),
    );
    assert.deepEqual(r.configJson, { source: 'legacy_search_url_template' });
  });
});

// ─── 3. supplierRowToApi ────────────────────────────────────────────────

function makeSupplierRow(over: Record<string, unknown> = {}): Parameters<
  typeof supplierRowToApi
>[0] {
  const base = {
    id: 'sup-1',
    name: 'Mercado Livre',
    site: 'mercadolivre.com.br',
    search_url_template: 'https://lista.mercadolivre.com.br/{q}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: new Date('2026-05-22T12:00:00.000Z'),
    updated_at: new Date('2026-05-22T12:00:00.000Z'),
    certification_status: 'unconfigured' as const,
    setup_status: 'unconfigured' as const,
    auto_configured_at: null,
  };
  return { ...base, ...over } as Parameters<typeof supplierRowToApi>[0];
}

describe('supplierRowToApi — sem recipe', () => {
  it('retorna campos legados em snake_case', () => {
    const s = supplierRowToApi(makeSupplierRow(), null);
    assert.equal(s.search_url_template, 'https://lista.mercadolivre.com.br/{q}');
    assert.equal(s.extraction_mode, 'jina_reader');
    assert.deepEqual(s.extractor_config, {});
  });

  it('retorna novos campos V2 em camelCase', () => {
    const s = supplierRowToApi(makeSupplierRow(), null);
    assert.equal(s.certificationStatus, 'unconfigured');
    assert.equal(s.setupStatus, 'unconfigured');
    assert.equal(s.autoConfiguredAt, null);
    assert.equal(s.recipe, null);
  });

  it('converte auto_configured_at Date para ISO string', () => {
    const s = supplierRowToApi(
      makeSupplierRow({
        auto_configured_at: new Date('2026-05-22T18:30:00.000Z'),
      }),
      null,
    );
    assert.equal(s.autoConfiguredAt, '2026-05-22T18:30:00.000Z');
  });

  it('certification_status="certified" e setup_status="needs_guided_setup" são preservados', () => {
    const s = supplierRowToApi(
      makeSupplierRow({
        certification_status: 'certified',
        setup_status: 'needs_guided_setup',
      }),
      null,
    );
    assert.equal(s.certificationStatus, 'certified');
    assert.equal(s.setupStatus, 'needs_guided_setup');
  });

  it('extractor_config nulo vira {}', () => {
    const s = supplierRowToApi(
      makeSupplierRow({ extractor_config: null as unknown as Record<string, unknown> }),
      null,
    );
    assert.deepEqual(s.extractor_config, {});
  });
});

describe('supplierRowToApi — com recipe', () => {
  it('embute a recipe passada como argumento', () => {
    const recipe: SupplierRecipe = recipeRowToApi(makeRecipeRow());
    const s = supplierRowToApi(makeSupplierRow(), recipe);
    assert.equal(s.recipe?.supplierId, 'sup-1');
    assert.equal(s.recipe?.status, 'unconfigured');
  });

  it('preserva supplier sem recipe quando recipe=null', () => {
    const s = supplierRowToApi(makeSupplierRow(), null);
    assert.equal(s.recipe, null);
  });
});

// ─── 4. Schema de criação ───────────────────────────────────────────────

describe('supplierCreateSchema — search_url_template opcional', () => {
  it('aceita criação sem search_url_template (default "")', () => {
    const parsed = supplierCreateSchema.parse({
      name: 'Loja Nova',
      site: 'lojanova.com.br',
    });
    assert.equal(parsed.search_url_template, '');
  });

  it('aceita criação com search_url_template explícito', () => {
    const parsed = supplierCreateSchema.parse({
      name: 'Loja Nova',
      site: 'lojanova.com.br',
      search_url_template: 'https://lojanova.com.br/busca?q={q}',
    });
    assert.equal(
      parsed.search_url_template,
      'https://lojanova.com.br/busca?q={q}',
    );
  });

  it('strip campos de sistema enviados pelo cliente (certification_status, setup_status, auto_configured_at)', () => {
    const parsed = supplierCreateSchema.parse({
      name: 'Loja Nova',
      site: 'lojanova.com.br',
      certification_status: 'certified',
      setup_status: 'certified',
      auto_configured_at: '2026-05-22T12:00:00.000Z',
    } as unknown as Record<string, unknown>);
    // Zod strip por padrão: campos extras não aparecem na saída
    assert.equal(
      (parsed as Record<string, unknown>)['certification_status'],
      undefined,
    );
    assert.equal(
      (parsed as Record<string, unknown>)['setup_status'],
      undefined,
    );
    assert.equal(
      (parsed as Record<string, unknown>)['auto_configured_at'],
      undefined,
    );
  });

  it('rejeita site vazio', () => {
    assert.throws(() =>
      supplierCreateSchema.parse({
        name: 'X',
        site: '',
      }),
    );
  });
});

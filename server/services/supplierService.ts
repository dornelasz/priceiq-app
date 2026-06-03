/**
 * CRUD de fornecedores.
 *
 * A partir da Fase B do Universal Adapter V2 a entidade `Supplier` carrega
 * também o status de certificação/setup e, opcionalmente, a `supplier_recipe`
 * associada. Campos antigos (search_url_template, extraction_mode,
 * extractor_config) permanecem intocados porque o motor de busca atual
 * ainda depende deles — a troca acontece em fase futura.
 */
import { query } from '../db/client.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { SupplierCreateInput, SupplierUpdateInput } from '../lib/validators.js';
import type {
  SupplierCertificationStatus,
  SupplierRecipe,
  ExtractionStrategy,
} from '../suppliers/v2/index.js';

// ─── Tipos públicos ─────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  site: string;
  search_url_template: string;
  country: string;
  currency: string;
  type: string;
  active: boolean;
  extraction_mode: string;
  extractor_config: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // ─── V2 (Fase B) ──────────────────────────────────────────────────────
  // Opcionais para compat com fixtures antigas e clientes que não enxergam
  // V2 ainda. Em produção, `supplierRowToApi` SEMPRE preenche estes campos.
  certificationStatus?: SupplierCertificationStatus;
  setupStatus?: SupplierCertificationStatus;
  autoConfiguredAt?: string | null;
  recipe?: SupplierRecipe | null;
}

// ─── Tipos internos de row ──────────────────────────────────────────────

interface SupplierRow {
  id: string;
  name: string;
  site: string;
  search_url_template: string;
  country: string;
  currency: string;
  type: string;
  active: boolean;
  extraction_mode: string;
  extractor_config: Record<string, unknown>;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  certification_status: SupplierCertificationStatus;
  setup_status: SupplierCertificationStatus;
  auto_configured_at: Date | null;
}

interface SupplierRecipeRow {
  id: string;
  supplier_id: string;
  status: SupplierCertificationStatus;
  platform_detected: string | null;
  search_url_template: string | null;
  product_url_patterns: unknown;
  extraction_strategy: ExtractionStrategy | null;
  title_selector: string | null;
  price_selector: string | null;
  currency_selector: string | null;
  image_selector: string | null;
  availability_selector: string | null;
  jsonld_enabled: boolean;
  json_paths: Record<string, unknown> | null;
  requires_js: boolean;
  requires_browser: boolean;
  confidence: string | number | null;
  last_tested_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  config_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Conversores puros (exportados para testes) ─────────────────────────

/**
 * Converte um row do PG da tabela supplier_recipes para a forma API V2.
 * Função pura — não toca em I/O. Pode ser testada isoladamente.
 */
export function recipeRowToApi(row: SupplierRecipeRow): SupplierRecipe {
  const confidence =
    row.confidence === null || row.confidence === undefined
      ? null
      : typeof row.confidence === 'string'
        ? Number(row.confidence)
        : row.confidence;

  return {
    id: row.id,
    supplierId: row.supplier_id,
    status: row.status,
    platformDetected: row.platform_detected,
    searchUrlTemplate: row.search_url_template,
    productUrlPatterns: Array.isArray(row.product_url_patterns)
      ? (row.product_url_patterns as string[])
      : [],
    extractionStrategy: row.extraction_strategy,
    titleSelector: row.title_selector,
    priceSelector: row.price_selector,
    currencySelector: row.currency_selector,
    imageSelector: row.image_selector,
    availabilitySelector: row.availability_selector,
    jsonLdEnabled: row.jsonld_enabled,
    jsonPaths: row.json_paths,
    requiresJs: row.requires_js,
    requiresBrowser: row.requires_browser,
    confidence,
    lastTestedAt: row.last_tested_at ? row.last_tested_at.toISOString() : null,
    lastSuccessAt: row.last_success_at ? row.last_success_at.toISOString() : null,
    lastError: row.last_error,
    configJson: row.config_json,
  };
}

/**
 * Converte um row da tabela suppliers para a forma API V2.
 * Recipe vem como argumento (carregada em separado).
 */
export function supplierRowToApi(
  row: SupplierRow,
  recipe: SupplierRecipe | null,
): Supplier {
  return {
    id: row.id,
    name: row.name,
    site: row.site,
    search_url_template: row.search_url_template,
    country: row.country,
    currency: row.currency,
    type: row.type,
    active: row.active,
    extraction_mode: row.extraction_mode,
    extractor_config: row.extractor_config ?? {},
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    certificationStatus: row.certification_status,
    setupStatus: row.setup_status,
    autoConfiguredAt: row.auto_configured_at
      ? row.auto_configured_at.toISOString()
      : null,
    recipe,
  };
}

// ─── Helpers internos ───────────────────────────────────────────────────

async function loadRecipesByIds(
  ids: string[],
): Promise<Map<string, SupplierRecipe>> {
  if (ids.length === 0) return new Map();
  const r = await query<SupplierRecipeRow>(
    `SELECT * FROM supplier_recipes WHERE supplier_id = ANY($1::uuid[])`,
    [ids],
  );
  const map = new Map<string, SupplierRecipe>();
  for (const row of r.rows) {
    map.set(row.supplier_id, recipeRowToApi(row));
  }
  return map;
}

// ─── API pública ────────────────────────────────────────────────────────

export const supplierService = {
  async list(): Promise<Supplier[]> {
    const r = await query<SupplierRow>(`SELECT * FROM suppliers ORDER BY name`);
    if (r.rows.length === 0) return [];
    const recipes = await loadRecipesByIds(r.rows.map((row) => row.id));
    return r.rows.map((row) => supplierRowToApi(row, recipes.get(row.id) ?? null));
  },

  async listActive(): Promise<Supplier[]> {
    const r = await query<SupplierRow>(
      `SELECT * FROM suppliers WHERE active = TRUE ORDER BY name`,
    );
    if (r.rows.length === 0) return [];
    const recipes = await loadRecipesByIds(r.rows.map((row) => row.id));
    return r.rows.map((row) => supplierRowToApi(row, recipes.get(row.id) ?? null));
  },

  async get(id: string): Promise<Supplier> {
    const r = await query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [id]);
    if (r.rowCount === 0 || !r.rows[0]) throw new NotFoundError('Fornecedor');
    const recipes = await loadRecipesByIds([id]);
    return supplierRowToApi(r.rows[0], recipes.get(id) ?? null);
  },

  async getManyByIds(ids: string[]): Promise<Supplier[]> {
    if (ids.length === 0) return [];
    const r = await query<SupplierRow>(
      `SELECT * FROM suppliers WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const recipes = await loadRecipesByIds(r.rows.map((row) => row.id));
    return r.rows.map((row) => supplierRowToApi(row, recipes.get(row.id) ?? null));
  },

  /**
   * Carrega só a recipe (sem o supplier). Útil para o RecipeRunner em fases
   * futuras. Retorna null quando ainda não há receita.
   */
  async getRecipe(supplierId: string): Promise<SupplierRecipe | null> {
    const r = await query<SupplierRecipeRow>(
      `SELECT * FROM supplier_recipes WHERE supplier_id = $1`,
      [supplierId],
    );
    if (r.rowCount === 0 || !r.rows[0]) return null;
    return recipeRowToApi(r.rows[0]);
  },

  async create(input: SupplierCreateInput): Promise<Supplier> {
    // Conflito por site único
    const existing = await query<{ id: string }>(
      `SELECT id FROM suppliers WHERE site = $1`,
      [input.site.toLowerCase()],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictError(`Fornecedor já existe para o site ${input.site}`);
    }

    // certification_status / setup_status / auto_configured_at usam DEFAULTs do schema
    // ('unconfigured', 'unconfigured', NULL). search_url_template aceita '' (default no schema).
    const r = await query<SupplierRow>(
      `INSERT INTO suppliers
         (name, site, search_url_template, country, currency, type, active,
          extraction_mode, extractor_config, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       RETURNING *`,
      [
        input.name,
        input.site.toLowerCase(),
        input.search_url_template,
        input.country,
        input.currency,
        input.type,
        input.active,
        input.extraction_mode,
        JSON.stringify(input.extractor_config ?? {}),
        input.notes ?? null,
      ],
    );
    if (!r.rows[0]) throw new Error('Falha ao criar fornecedor');
    // Recipe ainda não existe — virá da AutoConfig (fase futura).
    return supplierRowToApi(r.rows[0], null);
  },

  async update(id: string, patch: SupplierUpdateInput): Promise<Supplier> {
    await this.get(id); // valida existência

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const stringKeys: Array<keyof SupplierUpdateInput> = [
      'name', 'site', 'search_url_template', 'country', 'currency', 'type',
      'extraction_mode', 'notes',
    ];
    for (const k of stringKeys) {
      const v = patch[k];
      if (v === undefined) continue;
      fields.push(`${k} = $${idx++}`);
      values.push(k === 'site' && typeof v === 'string' ? v.toLowerCase() : v);
    }
    if (patch.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(patch.active);
    }
    if (patch.extractor_config !== undefined) {
      fields.push(`extractor_config = $${idx++}::jsonb`);
      values.push(JSON.stringify(patch.extractor_config));
    }

    if (fields.length === 0) return this.get(id);

    values.push(id);
    const r = await query<SupplierRow>(
      `UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    if (!r.rows[0]) throw new NotFoundError('Fornecedor');
    // update() NUNCA toca em supplier_recipes — preserva a receita salva.
    const recipes = await loadRecipesByIds([id]);
    return supplierRowToApi(r.rows[0], recipes.get(id) ?? null);
  },

  async delete(id: string): Promise<void> {
    // ON DELETE CASCADE em supplier_recipes garante limpeza.
    const r = await query(`DELETE FROM suppliers WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFoundError('Fornecedor');
  },

  /**
   * Atualiza apenas o status de certificação/setup do fornecedor.
   * `setAutoConfiguredAt=true` registra NOW() em auto_configured_at.
   * Não toca em nenhum campo legado nem em supplier_recipes.
   */
  async updateCertificationStatus(
    supplierId: string,
    status: SupplierCertificationStatus,
    opts: { setAutoConfiguredAt?: boolean } = {},
  ): Promise<void> {
    const sql = opts.setAutoConfiguredAt
      ? `UPDATE suppliers
         SET certification_status = $1, setup_status = $1, auto_configured_at = NOW()
         WHERE id = $2`
      : `UPDATE suppliers
         SET certification_status = $1, setup_status = $1
         WHERE id = $2`;
    const r = await query(sql, [status, supplierId]);
    if (r.rowCount === 0) throw new NotFoundError('Fornecedor');
  },

  /**
   * Insere ou atualiza a receita do fornecedor (1:1 via UNIQUE(supplier_id)).
   * Função idempotente — pode ser chamada quantas vezes for necessário pelo
   * AutoConfig sem criar receitas duplicadas.
   */
  async upsertRecipe(
    supplierId: string,
    recipe: Partial<SupplierRecipe> & {
      supplierId: string;
      status: SupplierCertificationStatus;
    },
  ): Promise<SupplierRecipe> {
    if (recipe.supplierId !== supplierId) {
      throw new Error('supplierId divergente entre argumento e recipe');
    }
    const r = await query<SupplierRecipeRow>(
      `INSERT INTO supplier_recipes (
         supplier_id, status, platform_detected, search_url_template,
         product_url_patterns, extraction_strategy, title_selector,
         price_selector, currency_selector, image_selector, availability_selector,
         jsonld_enabled, json_paths, requires_js, requires_browser, confidence,
         last_tested_at, last_success_at, last_error, config_json
       )
       VALUES (
         $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11,
         $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20::jsonb
       )
       ON CONFLICT (supplier_id) DO UPDATE SET
         status = EXCLUDED.status,
         platform_detected = EXCLUDED.platform_detected,
         search_url_template = EXCLUDED.search_url_template,
         product_url_patterns = EXCLUDED.product_url_patterns,
         extraction_strategy = EXCLUDED.extraction_strategy,
         title_selector = EXCLUDED.title_selector,
         price_selector = EXCLUDED.price_selector,
         currency_selector = EXCLUDED.currency_selector,
         image_selector = EXCLUDED.image_selector,
         availability_selector = EXCLUDED.availability_selector,
         jsonld_enabled = EXCLUDED.jsonld_enabled,
         json_paths = EXCLUDED.json_paths,
         requires_js = EXCLUDED.requires_js,
         requires_browser = EXCLUDED.requires_browser,
         confidence = EXCLUDED.confidence,
         last_tested_at = EXCLUDED.last_tested_at,
         last_success_at = EXCLUDED.last_success_at,
         last_error = EXCLUDED.last_error,
         config_json = EXCLUDED.config_json
       RETURNING *`,
      [
        supplierId,
        recipe.status,
        recipe.platformDetected ?? null,
        recipe.searchUrlTemplate ?? null,
        JSON.stringify(recipe.productUrlPatterns ?? []),
        recipe.extractionStrategy ?? null,
        recipe.titleSelector ?? null,
        recipe.priceSelector ?? null,
        recipe.currencySelector ?? null,
        recipe.imageSelector ?? null,
        recipe.availabilitySelector ?? null,
        recipe.jsonLdEnabled ?? false,
        recipe.jsonPaths ? JSON.stringify(recipe.jsonPaths) : null,
        recipe.requiresJs ?? false,
        recipe.requiresBrowser ?? false,
        recipe.confidence ?? null,
        recipe.lastTestedAt ?? null,
        recipe.lastSuccessAt ?? null,
        recipe.lastError ?? null,
        recipe.configJson ? JSON.stringify(recipe.configJson) : null,
      ],
    );
    if (!r.rows[0]) throw new Error('Falha ao persistir supplier_recipes');
    return recipeRowToApi(r.rows[0]);
  },
};

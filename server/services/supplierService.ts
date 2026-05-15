/**
 * CRUD de fornecedores — usa o schema Etapa 3.
 */
import { query } from '../db/client.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { SupplierCreateInput, SupplierUpdateInput } from '../lib/validators.js';

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
}

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
}

function toApi(row: SupplierRow): Supplier {
  return {
    ...row,
    extractor_config: row.extractor_config ?? {},
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export const supplierService = {
  async list(): Promise<Supplier[]> {
    const r = await query<SupplierRow>(`SELECT * FROM suppliers ORDER BY name`);
    return r.rows.map(toApi);
  },

  async listActive(): Promise<Supplier[]> {
    const r = await query<SupplierRow>(
      `SELECT * FROM suppliers WHERE active = TRUE ORDER BY name`,
    );
    return r.rows.map(toApi);
  },

  async get(id: string): Promise<Supplier> {
    const r = await query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [id]);
    if (r.rowCount === 0 || !r.rows[0]) throw new NotFoundError('Fornecedor');
    return toApi(r.rows[0]);
  },

  async getManyByIds(ids: string[]): Promise<Supplier[]> {
    if (ids.length === 0) return [];
    const r = await query<SupplierRow>(
      `SELECT * FROM suppliers WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return r.rows.map(toApi);
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

    const r = await query<SupplierRow>(
      `INSERT INTO suppliers
         (name, site, search_url_template, country, currency, type, active, extraction_mode, extractor_config, notes)
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
    return toApi(r.rows[0]);
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
    return toApi(r.rows[0]);
  },

  async delete(id: string): Promise<void> {
    const r = await query(`DELETE FROM suppliers WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFoundError('Fornecedor');
  },
};

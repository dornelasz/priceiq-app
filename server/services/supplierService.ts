/**
 * CRUD de fornecedores.
 *
 * Notas:
 *  - user_id NULL = fornecedor global (Mercado Livre, Amazon, etc).
 *  - Por enquanto NÃO há autenticação — todos os fornecedores listados são
 *    globais + customizados sem owner. Etapa de auth definirá o user_id.
 */
import { query } from '../db/pool.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { SupplierCreateInput, SupplierUpdateInput } from '../lib/validators.js';

export interface Supplier {
  id: string;
  user_id: string | null;
  name: string;
  site: string;
  url_template: string | null;
  type: string;
  country: string;
  currency: string;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SupplierRow {
  id: string;
  user_id: string | null;
  name: string;
  site: string;
  url_template: string | null;
  type: string;
  country: string;
  currency: string;
  enabled: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toApi(row: SupplierRow): Supplier {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export const supplierService = {
  async list(userId?: string | null): Promise<Supplier[]> {
    // Retorna globais (user_id IS NULL) + do usuário
    const r = await query<SupplierRow>(
      `SELECT * FROM suppliers
       WHERE user_id IS NULL OR user_id = $1
       ORDER BY user_id NULLS FIRST, name`,
      [userId ?? null],
    );
    return r.rows.map(toApi);
  },

  async get(id: string): Promise<Supplier> {
    const r = await query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [id]);
    if (r.rowCount === 0 || !r.rows[0]) throw new NotFoundError('Fornecedor');
    return toApi(r.rows[0]);
  },

  async create(input: SupplierCreateInput, userId?: string | null): Promise<Supplier> {
    // Bloqueia duplicata do mesmo site/owner
    const existing = await query<{ id: string }>(
      `SELECT id FROM suppliers WHERE site = $1 AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))`,
      [input.site.toLowerCase(), userId ?? null],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictError(`Fornecedor já existe para o site ${input.site}`);
    }

    const r = await query<SupplierRow>(
      `INSERT INTO suppliers (user_id, name, site, url_template, type, country, currency, enabled, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId ?? null,
        input.name,
        input.site.toLowerCase(),
        input.url_template ?? null,
        input.type,
        input.country,
        input.currency,
        input.enabled,
        input.notes ?? null,
      ],
    );
    if (!r.rows[0]) throw new Error('Falha ao criar fornecedor');
    return toApi(r.rows[0]);
  },

  async update(id: string, patch: SupplierUpdateInput): Promise<Supplier> {
    // Verifica existência
    await this.get(id);

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const keys: Array<keyof SupplierUpdateInput> = [
      'name', 'site', 'url_template', 'type', 'country', 'currency', 'enabled', 'notes',
    ];
    for (const k of keys) {
      const v = patch[k];
      if (v === undefined) continue;
      fields.push(`${k} = $${idx++}`);
      values.push(k === 'site' && typeof v === 'string' ? v.toLowerCase() : v);
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

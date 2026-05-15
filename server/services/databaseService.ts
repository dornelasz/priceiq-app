/**
 * databaseService — orquestra setup, migrações, seed e health do DB.
 *
 * Responsabilidades:
 *  - Aplicar migrações (`setup`)
 *  - Inserir/atualizar fornecedores padrão (`upsertSuppliers`)
 *  - Verificar saúde do DB (`health`)
 *  - Truncar dados (apenas em dev/test) — útil para reset
 */
import { pool, query, ping } from '../db/client.js';
import { runMigrations, listMigrations } from '../db/migrator.js';

export interface DbHealth {
  ok: boolean;
  applied_migrations: number;
  pending_migrations: number;
  pool_size: number;
  pool_idle: number;
  pool_waiting: number;
}

export interface SupplierSeed {
  name: string;
  site: string;
  search_url_template: string;
  country: string;
  currency: string;
  type: string;
  active: boolean;
  extraction_mode: string;
  extractor_config: Record<string, unknown>;
  notes?: string;
}

export const databaseService = {
  /**
   * Aplica todas as migrações pendentes. Idempotente.
   */
  async setup(): Promise<{ applied: string[]; skipped: string[] }> {
    return runMigrations();
  },

  /**
   * Insere fornecedores que ainda não existem (chave: site).
   * Atualiza search_url_template/active se já existir.
   */
  async upsertSuppliers(suppliers: SupplierSeed[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;
    for (const s of suppliers) {
      const r = await query<{ id: string }>(
        `INSERT INTO suppliers
           (name, site, search_url_template, country, currency, type, active, extraction_mode, extractor_config, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (site) DO NOTHING
         RETURNING id`,
        [
          s.name,
          s.site.toLowerCase(),
          s.search_url_template,
          s.country,
          s.currency,
          s.type,
          s.active,
          s.extraction_mode,
          JSON.stringify(s.extractor_config ?? {}),
          s.notes ?? null,
        ],
      );
      if (r.rowCount && r.rowCount > 0) inserted++;
      else skipped++;
    }
    return { inserted, skipped };
  },

  async health(): Promise<DbHealth> {
    const ok = await ping();
    const { applied, pending } = await listMigrations().catch(() => ({
      applied: [],
      pending: [] as string[],
    }));
    // pg.Pool tem propriedades públicas mas não tipadas
    type PoolWithStats = { totalCount: number; idleCount: number; waitingCount: number };
    const stats = pool as unknown as PoolWithStats;
    return {
      ok,
      applied_migrations: applied.length,
      pending_migrations: pending.length,
      pool_size: stats.totalCount,
      pool_idle: stats.idleCount,
      pool_waiting: stats.waitingCount,
    };
  },

  /**
   * APENAS para dev/test — apaga todos os dados (mantém schema).
   * Falha em produção (NODE_ENV=production) por segurança.
   */
  async truncateAll(): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('truncateAll() bloqueado em produção');
    }
    await query(
      `TRUNCATE TABLE search_results, searches, exchange_rates, app_settings, suppliers RESTART IDENTITY CASCADE`,
    );
  },
};

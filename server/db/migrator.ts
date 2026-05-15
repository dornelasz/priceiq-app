/**
 * Migrator simples — aplica .sql files de ./migrations/ em ordem alfabética
 * e marca como aplicado em _migrations.
 *
 * Convenção de nomes: NNNN_descricao.sql (ex: 0001_init.sql, 0002_add_xpto.sql)
 *
 * Garantias:
 *   - Idempotente (skipa migrations já aplicadas)
 *   - Transacional por migration (rollback automático se falhar)
 *   - Não destrutivo (nunca remove migrações ou tabelas existentes)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATIONS_TABLE = '_migrations';

export interface MigrationInfo {
  version: string;
  appliedAt: Date;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listAppliedVersions(): Promise<Set<string>> {
  const r = await pool.query<{ version: string }>(
    `SELECT version FROM ${MIGRATIONS_TABLE}`,
  );
  return new Set(r.rows.map((row) => row.version));
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function runMigrations(): Promise<{
  applied: string[];
  skipped: string[];
}> {
  await ensureMigrationsTable();
  const applied = await listAppliedVersions();
  const files = listMigrationFiles();

  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/i, '');
    if (applied.has(version)) {
      skipped.push(version);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrator] aplicando ${version}…`);
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES ($1)`,
        [version],
      );
    });
    newlyApplied.push(version);
    console.log(`[migrator] ✅ ${version} aplicada`);
  }

  return { applied: newlyApplied, skipped };
}

export async function listMigrations(): Promise<{
  applied: MigrationInfo[];
  pending: string[];
}> {
  await ensureMigrationsTable();
  const r = await pool.query<{ version: string; applied_at: Date }>(
    `SELECT version, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`,
  );
  const appliedSet = new Set(r.rows.map((row) => row.version));
  const files = listMigrationFiles();
  const pending = files
    .map((f) => f.replace(/\.sql$/i, ''))
    .filter((v) => !appliedSet.has(v));
  return {
    applied: r.rows.map((row) => ({ version: row.version, appliedAt: row.applied_at })),
    pending,
  };
}

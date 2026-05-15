/**
 * CLI para aplicar migrações pendentes.
 * Uso: `npm run db:migrate` ou `npm run db:setup`
 */
import { closePool } from './client.js';
import { runMigrations, listMigrations } from './migrator.js';

async function main(): Promise<void> {
  console.log('🚀 Aplicando migrações…');
  const { applied, skipped } = await runMigrations();
  if (applied.length === 0) {
    console.log(`ℹ️  Nada para aplicar (${skipped.length} já existia(m))`);
  } else {
    console.log(`✅ ${applied.length} migração(ões) aplicada(s):`);
    applied.forEach((v) => console.log(`   - ${v}`));
  }
  const { applied: total } = await listMigrations();
  console.log(`📊 Total de migrações aplicadas: ${total.length}`);
  await closePool();
}

main().catch((e) => {
  console.error('❌ Migração falhou:', e);
  closePool().finally(() => process.exit(1));
});

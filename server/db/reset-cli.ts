/**
 * CLI para resetar o banco (APENAS em dev/test).
 * Uso: `npm run db:reset`
 *
 * Apaga todos os dados (TRUNCATE), preserva schema.
 * Bloqueado em produção por segurança.
 */
import { closePool } from './client.js';
import { databaseService } from '../services/databaseService.js';

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.error('❌ db:reset bloqueado em produção');
    process.exit(1);
  }
  console.log('🧹 Truncando todas as tabelas…');
  await databaseService.truncateAll();
  console.log('✅ Banco limpo. Rode `npm run db:seed` para repopular.');
  await closePool();
}

main().catch((e) => {
  console.error('❌ Reset falhou:', e);
  closePool().finally(() => process.exit(1));
});

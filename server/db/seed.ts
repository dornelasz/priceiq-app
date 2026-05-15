/**
 * Seed do banco — roda migrações + insere fornecedores padrão (idempotente).
 *
 * Uso: `npm run db:seed` (dentro de server/)
 *
 * Os fornecedores são os mesmos que existem no `index.html` original do
 * PriceIQ — não criamos novos, apenas migramos para o Postgres.
 */
import { closePool } from './client.js';
import { databaseService } from '../services/databaseService.js';
import { runMigrations } from './migrator.js';

interface DefaultSupplier {
  name: string;
  site: string;
  search_url_template: string;
  country: string;
  currency: 'BRL' | 'USD' | 'EUR' | 'CNY';
  type: 'Nacional' | 'Internacional';
  active: boolean;
  extraction_mode: 'jina_reader' | 'playwright' | 'direct_api';
  extractor_config: Record<string, unknown>;
  notes: string;
}

// Fornecedores que existem no index.html original — não inventamos novos
const DEFAULT_SUPPLIERS: DefaultSupplier[] = [
  {
    name: 'Mercado Livre',
    site: 'mercadolivre.com.br',
    search_url_template: 'https://lista.mercadolivre.com.br/{q}',
    country: 'Brasil', currency: 'BRL', type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Maior marketplace do Brasil',
  },
  {
    name: 'Amazon BR',
    site: 'amazon.com.br',
    search_url_template: 'https://www.amazon.com.br/s?k={q}',
    country: 'Brasil', currency: 'BRL', type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Amazon Brasil',
  },
  {
    name: 'Shopee',
    site: 'shopee.com.br',
    search_url_template: 'https://shopee.com.br/search?keyword={q}',
    country: 'Brasil', currency: 'BRL', type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Crescimento acelerado',
  },
  {
    name: 'Magalu',
    site: 'magazineluiza.com.br',
    search_url_template: 'https://www.magazineluiza.com.br/busca/{q}/',
    country: 'Brasil', currency: 'BRL', type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Grande varejista nacional',
  },
  {
    name: 'AliExpress',
    site: 'aliexpress.com',
    search_url_template: 'https://www.aliexpress.com/wholesale?SearchText={q}',
    country: 'China', currency: 'USD', type: 'Internacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Varejo chinês',
  },
  {
    name: 'Alibaba',
    site: 'alibaba.com',
    search_url_template: 'https://www.alibaba.com/trade/search?SearchText={q}',
    country: 'China', currency: 'USD', type: 'Internacional',
    active: false,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Atacado B2B',
  },
  {
    name: 'Amazon USA',
    site: 'amazon.com',
    search_url_template: 'https://www.amazon.com/s?k={q}',
    country: 'EUA', currency: 'USD', type: 'Internacional',
    active: false,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: 'Amazon americana',
  },
];

async function main(): Promise<void> {
  console.log('🚀 Seed iniciando…');

  // 1. Roda migrações
  const { applied, skipped } = await runMigrations();
  console.log(`✅ Migrations: ${applied.length} aplicada(s), ${skipped.length} já existia(m)`);

  // 2. Insere fornecedores padrão (idempotente por site único)
  const upserted = await databaseService.upsertSuppliers(DEFAULT_SUPPLIERS);
  console.log(`✅ ${upserted.inserted} fornecedor(es) novo(s), ${upserted.skipped} já existia(m)`);

  // 3. Fecha pool
  await closePool();
  console.log('🏁 Seed concluído');
}

main().catch((e) => {
  console.error('❌ Seed falhou:', e);
  closePool().finally(() => process.exit(1));
});

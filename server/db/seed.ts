/**
 * Seed do banco — aplica schema.sql + insere fornecedores padrão (idempotente).
 *
 * Uso: `npm run db:seed` (dentro de server/)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DefaultSupplier {
  name: string;
  site: string;
  url_template: string;
  type: 'Nacional' | 'Internacional';
  country: string;
  currency: 'BRL' | 'USD' | 'EUR' | 'CNY';
  enabled: boolean;
  notes: string;
}

const DEFAULT_SUPPLIERS: DefaultSupplier[] = [
  {
    name: 'Mercado Livre',
    site: 'mercadolivre.com.br',
    url_template: 'https://lista.mercadolivre.com.br/{q}',
    type: 'Nacional', country: 'Brasil', currency: 'BRL', enabled: true,
    notes: 'Maior marketplace do Brasil',
  },
  {
    name: 'Amazon BR',
    site: 'amazon.com.br',
    url_template: 'https://www.amazon.com.br/s?k={q}',
    type: 'Nacional', country: 'Brasil', currency: 'BRL', enabled: true,
    notes: 'Amazon Brasil',
  },
  {
    name: 'Shopee',
    site: 'shopee.com.br',
    url_template: 'https://shopee.com.br/search?keyword={q}',
    type: 'Nacional', country: 'Brasil', currency: 'BRL', enabled: true,
    notes: 'Crescimento acelerado',
  },
  {
    name: 'Magalu',
    site: 'magazineluiza.com.br',
    url_template: 'https://www.magazineluiza.com.br/busca/{q}/',
    type: 'Nacional', country: 'Brasil', currency: 'BRL', enabled: true,
    notes: 'Grande varejista',
  },
  {
    name: 'AliExpress',
    site: 'aliexpress.com',
    url_template: 'https://www.aliexpress.com/wholesale?SearchText={q}',
    type: 'Internacional', country: 'China', currency: 'USD', enabled: true,
    notes: 'Varejo chinês',
  },
  {
    name: 'Alibaba',
    site: 'alibaba.com',
    url_template: 'https://www.alibaba.com/trade/search?SearchText={q}',
    type: 'Internacional', country: 'China', currency: 'USD', enabled: false,
    notes: 'Atacado B2B',
  },
  {
    name: 'Amazon USA',
    site: 'amazon.com',
    url_template: 'https://www.amazon.com/s?k={q}',
    type: 'Internacional', country: 'EUA', currency: 'USD', enabled: false,
    notes: 'Amazon americana',
  },
];

async function main(): Promise<void> {
  console.log('🚀 Seed iniciando…');

  // 1. Aplica schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('✅ Schema aplicado');

  // 2. Insere fornecedores padrão (idempotente: pula se já existe global do mesmo site)
  let inserted = 0;
  for (const s of DEFAULT_SUPPLIERS) {
    const r = await query(
      `INSERT INTO suppliers (name, site, url_template, type, country, currency, enabled, notes, user_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM suppliers WHERE user_id IS NULL AND site = $2
       )
       RETURNING id`,
      [s.name, s.site, s.url_template, s.type, s.country, s.currency, s.enabled, s.notes],
    );
    if (r.rowCount && r.rowCount > 0) {
      inserted++;
      console.log(`   + ${s.name} (${s.site})`);
    }
  }

  if (inserted === 0) {
    console.log('ℹ️  Todos os fornecedores padrão já existem');
  } else {
    console.log(`✅ ${inserted} fornecedor(es) inseridos`);
  }

  await pool.end();
  console.log('🏁 Seed concluído');
}

main().catch((e) => {
  console.error('❌ Seed falhou:', e);
  process.exit(1);
});

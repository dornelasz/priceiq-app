import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default('info'),

  FRONTEND_URL: z.string().default('http://localhost:5173'),
  // Alternativa a FRONTEND_URL para CORS. Se definida, tem precedência.
  // Aceita múltiplas origens separadas por vírgula (ex: https://a.app,https://b.app).
  CORS_ORIGIN: z.string().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),
  // Gemini é OPCIONAL — desligado por padrão. Quando ligado, atua só como
  // interpretador de texto JÁ coletado por scrapers. NUNCA é fonte de preço.
  GEMINI_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  GEMINI_OPTIONAL: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  USE_GEMINI_AS_FALLBACK_ONLY: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),

  RATES_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  SUPPLIER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  SEARCH_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // Match score mínimo para aceitar resultado (abaixo disso → rejeita)
  // Conforme Motor Universal: <50 rejeita, 50-74 aceita com warning, ≥75 confiável
  MIN_MATCH_SCORE: z.coerce.number().int().min(0).max(100).default(50),
  // Score acima do qual o resultado é considerado de alta confiança (sem warning de match)
  MATCH_SCORE_TRUSTED: z.coerce.number().int().min(0).max(100).default(75),
  // Cache de busca por (supplier_id, normalized_query). Default ligado.
  ENABLE_SEARCH_CACHE: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),

  // ─── Firecrawl (provider de coleta, opcional) ───────────
  // Integra ao V2 como provider de busca e produto em sites que bloqueiam
  // direct_fetch (ex: Amazon BR, Shopee). Nunca hardcode a chave.
  //
  // Para ativar no Render:
  //   FIRECRAWL_API_KEY=fc-<sua-chave>
  //   FIRECRAWL_MODE=fallback   (ou preferred para Firecrawl primeiro)
  //
  // Com API key vazia: Firecrawl desativado, só direct_fetch é usado.
  FIRECRAWL_API_KEY: z.string().default(''),
  FIRECRAWL_MODE: z.enum(['preferred', 'fallback']).default('fallback'),

  // ─── Playwright (último fallback, opcional) ──────────────
  // Desligado por padrão. Para usar:
  //   cd server && npm install playwright && npx playwright install chromium
  //   PLAYWRIGHT_ENABLED=true
  PLAYWRIGHT_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  PLAYWRIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  MAX_PLAYWRIGHT_PAGES_PER_SEARCH: z.coerce.number().int().min(1).max(5).default(1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export type Config = typeof config;

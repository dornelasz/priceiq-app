/**
 * Scraper baseado em Playwright — fallback para sites que bloqueiam Jina
 * (CAPTCHAs, Cloudflare, SPAs pesadas).
 *
 * NOTA: Playwright requer ~300MB de Chromium baixado. Está como STUB
 * por padrão. Para habilitar em produção:
 *   1. cd server && npm install playwright
 *   2. npx playwright install chromium
 *   3. setar PLAYWRIGHT_ENABLED=true no .env
 *
 * Este stub permite a interface existir e ser referenciada pelo dispatcher
 * sem custo de instalação. Quando não disponível, retorna found:false
 * com errorMessage explicativo (worker tentará próximo scraper).
 */
import type { Supplier } from '../services/supplierService.js';
import type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';

let playwrightAvailable = false;
let chromium: unknown = null;
let probed = false;

async function tryLoadPlaywright(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    // Import dinâmico — não quebra se a dep não estiver instalada
    const pw = await import(/* @vite-ignore */ 'playwright' as string).catch(() => null);
    if (pw && typeof pw === 'object' && 'chromium' in pw) {
      chromium = (pw as { chromium: unknown }).chromium;
      playwrightAvailable = true;
    }
  } catch {
    playwrightAvailable = false;
  }
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  await tryLoadPlaywright();
  return playwrightAvailable;
}

export async function scrapeViaPlaywright(
  supplier: Supplier,
  _query: string,
  _opts: ScrapeOptions,
): Promise<ScrapedResult> {
  await tryLoadPlaywright();
  if (!playwrightAvailable || !chromium) {
    return {
      found: false,
      errorMessage:
        'Playwright não instalado — instale com `npm install playwright && npx playwright install chromium`',
    };
  }
  // Implementação real fica para etapa futura (quando demanda exigir).
  return {
    found: false,
    errorMessage: `Playwright disponível mas scraper headless ainda não implementado para ${supplier.site}`,
  };
}

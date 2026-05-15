/**
 * Scraper baseado em Playwright — placeholder funcional.
 *
 * NOTA: Playwright requer ~300MB de Chromium baixado. Não habilitado por padrão.
 * Para ativar:
 *   1. cd server
 *   2. npm install playwright
 *   3. npx playwright install chromium
 *   4. setar PLAYWRIGHT_ENABLED=true no .env
 *
 * Esse stub permite a interface estar pronta sem custo de instalação. O
 * searchService detecta se está disponível e cai pro Jina quando não está.
 */
import type { Supplier } from '../services/supplierService.js';
import type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';

let playwrightAvailable = false;
let chromium: unknown = null;

async function tryLoadPlaywright(): Promise<void> {
  if (playwrightAvailable || chromium) return;
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

export function isPlaywrightAvailable(): boolean {
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
  // Implementação real fica para Etapa 4 (quando suppliers customizados
  // exigirem JS rendering). Por enquanto, retorna stub explícito.
  return {
    found: false,
    errorMessage: `Playwright disponível mas scraper ainda não implementado para ${supplier.site}`,
  };
}

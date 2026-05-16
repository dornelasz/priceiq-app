/**
 * Universal Supplier Search Engine — dispatcher.
 *
 * O usuário NÃO escolhe estratégia. Cada fornecedor é processado pelo motor
 * universal, que tenta automaticamente em cascata:
 *
 *   1. URL otimizada por marketplace conhecido (Mercado Livre, Amazon, Shopee,
 *      Magalu, AliExpress) — só ajusta o formato da URL de busca.
 *   2. Fetch direto do HTML (sites SSR/estáticos).
 *   3. Jina Reader (sites JS-heavy / SPA).
 *   4. Playwright (apenas se disponível e Jina foi bloqueado).
 *
 * Para QUALQUER conteúdo coletado, o directExtractor tenta:
 *   - JSON-LD (schema.org Product)
 *   - __NEXT_DATA__ e outros JSON embedded
 *   - markdown/texto com regex de preço + URL + nome
 *
 * Gemini é OPCIONAL (desligado por padrão) e age apenas como interpretador de
 * texto JÁ coletado. Nunca pesquisa, nunca inventa preço, nunca bloqueia a busca.
 */
import type { Supplier } from '../services/supplierService.js';
import type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';
import { scrapeViaJinaReader } from './jinaReaderScraper.js';
import { scrapeViaPlaywright, isPlaywrightAvailable } from './genericPlaywrightScraper.js';
import { scrapeMercadoLivre } from './mercadoLivreScraper.js';
import { scrapeAmazon } from './amazonScraper.js';
import { scrapeShopee } from './shopeeScraper.js';
import { scrapeMagalu } from './magaluScraper.js';
import { scrapeAliExpress } from './aliexpressScraper.js';
import { scrapeCustomSupplier } from './customSupplierScraper.js';

export type ScraperFn = (
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
) => Promise<ScrapedResult>;

export function getSpecificScraper(supplier: Supplier): ScraperFn | null {
  const site = supplier.site.toLowerCase().replace(/^www\./, '');
  if (site.includes('mercadolivre.com.br') || site.includes('mercadolibre')) return scrapeMercadoLivre;
  if (site.includes('amazon.com.br') || site === 'amazon.com')                 return scrapeAmazon;
  if (site.includes('shopee.com.br'))                                          return scrapeShopee;
  if (site.includes('magazineluiza.com.br') || site.includes('magalu'))        return scrapeMagalu;
  if (site.includes('aliexpress.com'))                                         return scrapeAliExpress;
  return null;
}

export interface ScrapeAttempt {
  strategy: 'specific' | 'jina' | 'playwright' | 'custom';
  result: ScrapedResult;
}

/**
 * Heurística: o erro indica que Jina foi BLOQUEADA (não que extração falhou).
 * Quando bloqueada, faz sentido tentar Playwright. Quando extração apenas
 * não achou nada, Playwright provavelmente não ajuda (mesmo conteúdo).
 */
function shouldFallbackToPlaywright(result: ScrapedResult): boolean {
  if (!result || result.found) return false;
  const msg = String(result.errorMessage ?? '').toLowerCase();
  if (msg.includes('bloqueou') || msg.includes('http 451') || msg.includes('http 429') || msg.includes('http 403')) return true;
  const src = result.sourceName ?? '';
  if (src === 'jina-blocked' || src === 'jina-fetch-error' || src === 'jina-empty') return true;
  if (src === 'fetch-blocked' || src === 'fetch-error') return true;
  return false;
}

/**
 * Tenta extrair o preço seguindo a cadeia de estratégias.
 * Retorna o PRIMEIRO sucesso OU o último erro tipado.
 */
export async function scrapeWithFallback(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapeAttempt> {
  const attempts: ScrapeAttempt[] = [];

  // 1. Scraper específico (se conhecido)
  const specific = getSpecificScraper(supplier);
  if (specific) {
    const result = await specific(supplier, query, opts);
    attempts.push({ strategy: 'specific', result });
    if (result.found) return { strategy: 'specific', result };
  }

  // 2. Jina/Custom (se sem específico OU se específico falhou)
  if (!specific) {
    const result = await scrapeViaJinaReader(supplier, query, opts);
    attempts.push({ strategy: 'jina', result });
    if (result.found) return { strategy: 'jina', result };
  } else if (supplier.search_url_template) {
    const result = await scrapeCustomSupplier(supplier, query, opts);
    attempts.push({ strategy: 'custom', result });
    if (result.found) return { strategy: 'custom', result };
  }

  // 3. Playwright APENAS se Jina foi bloqueada/falhou no fetch
  const lastFailure = attempts[attempts.length - 1]?.result;
  if (lastFailure && shouldFallbackToPlaywright(lastFailure) && (await isPlaywrightAvailable())) {
    const result = await scrapeViaPlaywright(supplier, query, opts);
    attempts.push({ strategy: 'playwright', result });
    if (result.found) return { strategy: 'playwright', result };
  }

  // Nenhuma estratégia teve sucesso — retorna o último resultado (com erro tipado)
  return attempts[attempts.length - 1] ?? {
    strategy: 'jina',
    result: {
      found: false,
      errorMessage: 'nenhuma estratégia de scraper disponível',
      sourceName: 'no-strategy',
    },
  };
}

export type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';

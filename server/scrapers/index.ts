/**
 * Dispatcher de scrapers — escolhe a estratégia em ordem de prioridade:
 *
 *  1. Scraper ESPECÍFICO do fornecedor (Mercado Livre, Amazon, Shopee, Magalu, AliExpress)
 *  2. Jina Reader genérico
 *  3. Playwright (stub por padrão; ativado via PLAYWRIGHT_ENABLED)
 *
 * Cada tentativa retorna ScrapedResult; o worker decide se prossegue para a
 * próxima estratégia (ex: se Jina falhar com "vazio", tenta Playwright se ativo).
 *
 * Gemini é usado SEMPRE como interpretador final dentro de cada scraper —
 * nunca é chamado direto como estratégia.
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

/**
 * Identifica o scraper específico do fornecedor (se houver).
 * Casa pelo campo `site` do supplier (case-insensitive, ignora www.).
 */
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
 * Tenta extrair o preço seguindo a cadeia de estratégias.
 * Retorna o PRIMEIRO sucesso (found=true) OU o último erro.
 *
 * Estratégia:
 *   1. Scraper específico do fornecedor (se conhecido)
 *   2. Custom (se houver search_url_template) — equivalente ao Jina genérico
 *   3. Playwright (somente se disponível)
 *
 * Cada estratégia já usa Gemini internamente como interpretador.
 */
export async function scrapeWithFallback(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapeAttempt> {
  const attempts: ScrapeAttempt[] = [];

  // 1. Scraper específico
  const specific = getSpecificScraper(supplier);
  if (specific) {
    const result = await specific(supplier, query, opts);
    attempts.push({ strategy: 'specific', result });
    if (result.found) return { strategy: 'specific', result };
    if (result.quotaExceeded) return { strategy: 'specific', result };
  }

  // 2. Jina Reader / Custom (se não tem específico OU específico falhou)
  if (!specific) {
    const result = await scrapeViaJinaReader(supplier, query, opts);
    attempts.push({ strategy: 'jina', result });
    if (result.found) return { strategy: 'jina', result };
    if (result.quotaExceeded) return { strategy: 'jina', result };
  } else if (supplier.search_url_template) {
    // Fornecedor específico falhou — tenta com template customizado
    const result = await scrapeCustomSupplier(supplier, query, opts);
    attempts.push({ strategy: 'custom', result });
    if (result.found) return { strategy: 'custom', result };
    if (result.quotaExceeded) return { strategy: 'custom', result };
  }

  // 3. Playwright (último recurso, só se ativo)
  if (await isPlaywrightAvailable()) {
    const result = await scrapeViaPlaywright(supplier, query, opts);
    attempts.push({ strategy: 'playwright', result });
    if (result.found) return { strategy: 'playwright', result };
  }

  // Nenhuma estratégia funcionou — retorna o último erro com a estratégia que tentou
  const last = attempts[attempts.length - 1];
  return last ?? {
    strategy: 'jina',
    result: { found: false, errorMessage: 'nenhuma estratégia de scraper disponível' },
  };
}

export type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';

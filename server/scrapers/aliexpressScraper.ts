/**
 * Scraper específico do AliExpress.
 *
 * URL: aliexpress.com/wholesale?SearchText=<query>.
 * Preços vêm em USD por padrão. Conversão para BRL é feita no worker
 * usando a cotação Investing do currencyService.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractViaJinaAndGemini, type ScrapeOptions, type ScrapedResult } from './jinaReaderScraper.js';

export async function scrapeAliExpress(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`;
  const result = await extractViaJinaAndGemini(supplier, query, searchUrl, opts);
  // Garante currency USD se Gemini retornar vazio
  if (result.found && !result.currency) {
    return { ...result, currency: 'USD' };
  }
  return result;
}

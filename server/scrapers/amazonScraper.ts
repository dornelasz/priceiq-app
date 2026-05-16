/**
 * Scraper específico da Amazon (BR e USA).
 *
 * URL: amazon.com[.br]/s?k=<query>. Tem bot detection forte; Jina passa
 * boa parte das vezes mas pode retornar CAPTCHA. Resultado é entregue ao
 * Gemini como interpretador final.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractViaJina, type ScrapeOptions, type ScrapedResult } from './jinaReaderScraper.js';

function buildAmazonSearchUrl(supplier: Supplier, query: string): string {
  const host = supplier.site.toLowerCase().includes('amazon.com.br')
    ? 'amazon.com.br'
    : 'amazon.com';
  return `https://www.${host}/s?k=${encodeURIComponent(query)}`;
}

export async function scrapeAmazon(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildAmazonSearchUrl(supplier, query);
  const result = await extractViaJina(supplier, query, searchUrl, opts);

  // Amazon costuma dar CAPTCHA — se conteúdo for muito curto/erro, marca warning específico
  if (!result.found && result.errorMessage?.includes('Jina')) {
    return {
      ...result,
      errorMessage: 'Amazon bloqueou scraping (CAPTCHA/bot detection). Tente novamente.',
    };
  }
  return result;
}

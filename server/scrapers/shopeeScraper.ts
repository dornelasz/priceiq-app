/**
 * Scraper específico da Shopee Brasil.
 *
 * URL: shopee.com.br/search?keyword=<query>. Shopee é SPA pesada,
 * Jina às vezes retorna conteúdo escasso. Quando isso acontecer, marcamos
 * warning para o usuário.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractViaJinaAndGemini, type ScrapeOptions, type ScrapedResult } from './jinaReaderScraper.js';

export async function scrapeShopee(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(query)}`;
  const result = await extractViaJinaAndGemini(supplier, query, searchUrl, opts);
  // Para Shopee, qualquer warning de conteúdo curto vira mensagem específica
  if (!result.found && result.errorMessage?.includes('vazio')) {
    return {
      ...result,
      errorMessage: 'Shopee (SPA) retornou conteúdo limitado — produto pode existir mas não foi extraível.',
    };
  }
  return result;
}

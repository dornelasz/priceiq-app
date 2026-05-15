/**
 * Scraper genérico para fornecedores customizados (adicionados pelo usuário
 * na tela Lojas). Usa o search_url_template definido pelo usuário e delega
 * tudo ao engine Jina + Gemini.
 *
 * É o último recurso quando o supplier.site não casa com nenhum scraper
 * específico (Mercado Livre, Amazon, Shopee, Magalu, AliExpress).
 */
import type { Supplier } from '../services/supplierService.js';
import {
  buildDefaultSearchUrl,
  extractViaJinaAndGemini,
  type ScrapeOptions,
  type ScrapedResult,
} from './jinaReaderScraper.js';

export async function scrapeCustomSupplier(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildDefaultSearchUrl(supplier, query);
  return extractViaJinaAndGemini(supplier, query, searchUrl, opts);
}

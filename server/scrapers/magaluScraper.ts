/**
 * Scraper específico do Magalu (Magazine Luiza).
 *
 * URL: magazineluiza.com.br/busca/<slug>/. Página é SSR (Next.js no servidor
 * do Magalu) então Jina costuma extrair bem.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractViaJinaAndGemini, type ScrapeOptions, type ScrapedResult } from './jinaReaderScraper.js';

function buildMagaluSearchUrl(query: string): string {
  const slug = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `https://www.magazineluiza.com.br/busca/${encodeURIComponent(slug)}/`;
}

export async function scrapeMagalu(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildMagaluSearchUrl(query);
  return extractViaJinaAndGemini(supplier, query, searchUrl, opts);
}

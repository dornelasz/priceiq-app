/**
 * Scraper específico do Mercado Livre.
 *
 * O ML usa slugs com hífens (lista.mercadolivre.com.br/iphone-13-128gb)
 * em vez de query params. Esta função constrói essa URL otimizada e
 * delega a extração para o engine genérico Jina + Gemini.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractViaJinaAndGemini, type ScrapeOptions, type ScrapedResult } from './jinaReaderScraper.js';

function buildMlSlugUrl(query: string): string {
  const slug = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`;
}

export async function scrapeMercadoLivre(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  // ML aceita tanto slug quanto search?as= — slug é melhor indexado
  const searchUrl = buildMlSlugUrl(query);
  return extractViaJinaAndGemini(supplier, query, searchUrl, opts);
}

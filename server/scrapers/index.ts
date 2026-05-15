/**
 * Dispatcher de scrapers — escolhe a estratégia em ordem de prioridade.
 *
 * ORDEM OFICIAL (pós-fix anti-quota-Gemini):
 *
 *   1. Scraper ESPECÍFICO do fornecedor (Mercado Livre, Amazon, Shopee, Magalu, AliExpress)
 *      → Internamente: Jina → extração direta → Gemini opcional
 *   2. Jina Reader genérico (mesmo motor, URL padrão)
 *   3. Playwright (se ativo) — usado quando Jina é bloqueado (451/403/429)
 *
 * Gemini APENAS como interpretador interno e opcional, NUNCA estratégia primária.
 * Erro de quota Gemini é warning discreto, não bloqueia a busca.
 *
 * Sites que bloqueiam Jina (Alibaba, etc) → fallback automático para Playwright
 * se ativo. Sem Playwright → erro isolado naquele fornecedor.
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
  if (result.sourceName === 'jina-blocked' || result.sourceName === 'jina-fetch-error') return true;
  if (result.sourceName === 'jina-empty') return true;
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

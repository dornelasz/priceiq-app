/**
 * Worker in-process — orquestra a busca real para uma search criada.
 *
 * Fluxo por fornecedor:
 *   1. Se !forceRefresh → consulta cache (supplier_id + normalized_query)
 *      • cache hit → grava como from_cache=true e segue
 *   2. Cache miss / forceRefresh → scrapeWithFallback (específico → Jina → Playwright)
 *   3. Se o scraper achou: converte para BRL, grava em search_results
 *   4. Se NÃO achou: grava como erro/warning (NUNCA inventa preço)
 *   5. Cache do resultado (se preço válido) para próxima busca da mesma query
 *
 * Concorrência controlada pelo SEARCH_CONCURRENCY.
 * Falha isolada: se um fornecedor estourar exception, os outros continuam.
 *
 * Ao final, chama finalizeStatus() que define:
 *   - completed     (todos OK)
 *   - partial_failed (alguns OK, alguns falharam)
 *   - failed        (nenhum OK)
 */
import { config } from '../config.js';
import { searchService } from '../services/searchService.js';
import type { Supplier } from '../services/supplierService.js';
import { cacheService } from '../services/cacheService.js';
import { matchingService } from '../services/matchingService.js';
import { scrapeWithFallback, type ScrapedResult } from '../scrapers/index.js';

export interface WorkerInput {
  searchId: string;
  query: string;
  suppliers: Supplier[];
  forceRefresh: boolean;
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Array<Promise<void>> = [];
  const workerCount = Math.min(limit, items.length);
  for (let w = 0; w < workerCount; w++) {
    runners.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) break;
          try {
            await task(items[i] as T, i);
          } catch (e) {
            console.error('[worker] task escapou:', e);
          }
        }
      })(),
    );
  }
  await Promise.all(runners);
}

function applyTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`tempo esgotado para ${label}`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

interface CachedResult extends ScrapedResult {
  cachedAt: string;
}

export async function runSearchWorker(input: WorkerInput): Promise<void> {
  const { searchId, query, suppliers, forceRefresh } = input;
  const normalizedQuery = matchingService.cacheKey(query);

  if (suppliers.length === 0) {
    await searchService.finalizeStatus(searchId);
    return;
  }

  await searchService.markRunning(searchId).catch(() => {});

  // NOTA: quota Gemini esgotada NÃO bloqueia outros fornecedores.
  // O motor principal é extração direta (sem IA). Gemini é só fallback opcional.

  await withConcurrency(suppliers, config.SEARCH_CONCURRENCY, async (sup) => {
    // ─── 1. Tenta cache ─────────────────────────────────
    let scraped: ScrapedResult | null = null;
    let fromCache = false;
    if (!forceRefresh) {
      const cached = await cacheService.getSupplierResult<CachedResult>(sup.id, normalizedQuery);
      if (cached && cached.found && typeof cached.price === 'number' && cached.price > 0) {
        scraped = cached;
        fromCache = true;
      }
    }

    // ─── 2. Cache miss → scraper com fallback ──────────
    if (!scraped) {
      try {
        const attempt = await applyTimeout(
          scrapeWithFallback(sup, query, { timeoutMs: config.SUPPLIER_TIMEOUT_MS }),
          config.SUPPLIER_TIMEOUT_MS + 2000,
          sup.name,
        );
        scraped = attempt.result;
      } catch (e) {
        scraped = { found: false, errorMessage: (e as Error).message };
      }
    }

    // Gemini sem quota é warning interno; NÃO bloqueia outros fornecedores.

    // ─── 3. Persiste resultado ─────────────────────────
    try {
      if (scraped.found && typeof scraped.price === 'number' && scraped.price > 0 && scraped.currency) {
        const { brl, rate } = await searchService.convertToBrl(scraped.price, scraped.currency);
        const freight = scraped.freight ?? 0;
        const totalPrice = parseFloat((scraped.price + freight).toFixed(4));
        const totalBrl = rate > 0
          ? parseFloat((totalPrice * rate).toFixed(4))
          : brl + freight; // fallback: BRL sem rate

        await searchService.insertResult(searchId, sup, {
          found: true,
          productName: scraped.productName,
          sellerName: scraped.sellerName,
          price: scraped.price,
          freight,
          totalPrice,
          currency: scraped.currency,
          exchangeRateUsed: rate || undefined,
          totalBrl,
          productUrl: scraped.link,
          matchScore: scraped.matchScore,
          confidence: scraped.confidence,
          available: scraped.available,
          warning: scraped.warning,
          fromCache,
          // Etapa 5.1 — campos de validação
          linkType: scraped.linkType,
          linkValidated: scraped.linkValidated ?? false,
          evidenceText: scraped.evidenceText,
          sourceUrl: scraped.sourceUrl,
          sourceName: scraped.sourceName,
          validationWarning: scraped.validationWarning,
        });

        // Salva no cache (só se foi busca fresh — não recache cache)
        if (!fromCache) {
          const toCache: CachedResult = { ...scraped, cachedAt: new Date().toISOString() };
          void cacheService.setSupplierResult(sup.id, normalizedQuery, toCache)
            .catch((e) => console.warn('[worker] cache set falhou', e));
        }
      } else {
        // ─── REGRA-OURO: jamais inventar preço ──────────
        await searchService.insertResult(searchId, sup, {
          found: false,
          errorMessage: scraped.errorMessage ?? 'preço não encontrado com segurança',
          fromCache: false,
        });
      }
    } catch (e) {
      console.error('[worker] insertResult falhou', sup.name, e);
    }
  });

  // ─── 4. Status final ───────────────────────────────────
  try {
    await searchService.finalizeStatus(searchId);
  } catch (e) {
    console.error('[worker] finalizeStatus falhou', e);
  }
}

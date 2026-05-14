/**
 * Worker em processo — executa scrapers em paralelo com limite de concorrência.
 *
 * Garantias:
 *  - Cada fornecedor tem timeout individual (SUPPLIER_TIMEOUT_MS).
 *  - Se um fornecedor falha, os outros continuam.
 *  - Toda falha é registrada em search_results com error_message.
 *  - Status da busca evolui pending → running → completed.
 */
import { config } from '../config.js';
import { searchService } from '../services/searchService.js';
import type { Supplier } from '../services/supplierService.js';
import { scrapeViaJinaReader, type ScrapedResult } from '../scrapers/jinaReaderScraper.js';

export interface WorkerInput {
  searchId: string;
  query: string;
  suppliers: Supplier[];
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
            // task deve tratar — esse catch é só uma rede de segurança
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
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function runSearchWorker(input: WorkerInput): Promise<void> {
  const { searchId, query, suppliers } = input;

  try {
    await searchService.markRunning(searchId);
  } catch (e) {
    console.error('[worker] markRunning falhou', e);
  }

  if (suppliers.length === 0) {
    await searchService.markCompleted(searchId);
    return;
  }

  let quotaTripped = false;

  await withConcurrency(suppliers, config.SEARCH_CONCURRENCY, async (sup) => {
    if (quotaTripped) {
      // Quota Gemini esgotada — registra como skip
      await searchService.insertResult(searchId, sup, {
        found: false,
        errorMessage: 'Pulado — quota Gemini esgotada em fornecedor anterior',
      }).catch(() => {});
      await searchService.incrementCompleted(searchId).catch(() => {});
      return;
    }

    const startedAt = Date.now();
    let result: ScrapedResult;
    try {
      result = await applyTimeout(
        scrapeViaJinaReader(sup, query, { timeoutMs: config.SUPPLIER_TIMEOUT_MS }),
        config.SUPPLIER_TIMEOUT_MS + 2000,
        sup.name,
      );
    } catch (e) {
      result = {
        found: false,
        errorMessage: (e as Error).message,
      };
    }

    if (result.quotaExceeded) quotaTripped = true;

    const durationMs = Date.now() - startedAt;

    try {
      if (result.found && result.price && result.currency) {
        const priceBrl = await searchService.convertToBrl(result.price, result.currency);
        const freight = result.freight ?? 0;
        const totalBrl = parseFloat((priceBrl + freight * (priceBrl / result.price)).toFixed(4));
        await searchService.insertResult(searchId, sup, {
          found: true,
          productName: result.productName,
          price: result.price,
          currency: result.currency,
          priceBrl,
          link: result.link,
          linkType: result.linkType,
          sellerName: result.sellerName,
          productRating: result.productRating,
          productReviews: result.productReviews,
          freight: result.freight,
          freightNote: result.freightNote,
          freeShip: result.freeShip,
          totalBrl,
          confidence: result.confidence,
          sourceText: result.sourceText,
          rawData: result.rawData,
          durationMs,
        });
      } else {
        await searchService.insertResult(searchId, sup, {
          found: false,
          errorMessage: result.errorMessage ?? 'produto não encontrado',
          rawData: result.rawData,
          durationMs,
        });
      }
    } catch (e) {
      console.error('[worker] insertResult falhou', sup.name, e);
    }

    try {
      await searchService.incrementCompleted(searchId);
    } catch (e) {
      console.error('[worker] incrementCompleted falhou', e);
    }
  });

  try {
    await searchService.markCompleted(searchId);
  } catch (e) {
    console.error('[worker] markCompleted falhou', e);
  }
}

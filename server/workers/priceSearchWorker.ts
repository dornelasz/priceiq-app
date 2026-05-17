/**
 * Worker in-process — orquestra a busca real para uma search criada.
 *
 * Fluxo por fornecedor:
 *   1. Se !forceRefresh → consulta cache (supplier_id + normalized_query)
 *      • cache hit válido (validated + price + productName + evidenceText + URL)
 *        → grava como from_cache=true e segue
 *   2. Cache miss / forceRefresh → scrapeWithFallback (específico → Jina → Playwright)
 *   3. Se o scraper achou: converte para BRL, grava em search_results
 *   4. Se NÃO achou: grava como erro/warning (NUNCA inventa preço)
 *   5. Cache do resultado (só se isCacheValid — nunca cacheamos erros)
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
import { deriveWorkerStatus, type ResultStatus } from '../lib/resultStatus.js';
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

/**
 * Verifica se um resultado (do cache ou do scraper) é válido para ser
 * reutilizado/armazenado. Nunca cacheamos erros, timeouts ou resultados
 * sem evidência textual.
 *
 * Critérios obrigatórios:
 *  - found=true
 *  - status='validated'
 *  - price > 0
 *  - productName presente
 *  - evidenceText presente (anti produto-fantasma)
 *  - link ou sourceUrl presente (rastreabilidade)
 */
export function isCacheValid(cached: ScrapedResult): boolean {
  return (
    cached.found === true &&
    cached.status === 'validated' &&
    typeof cached.price === 'number' &&
    cached.price > 0 &&
    !!cached.productName &&
    !!cached.evidenceText &&
    !!(cached.link || cached.sourceUrl)
  );
}

export async function runSearchWorker(input: WorkerInput): Promise<void> {
  const { searchId, query, suppliers, forceRefresh } = input;
  const normalizedQuery = matchingService.cacheKey(query);

  if (suppliers.length === 0) {
    await searchService.finalizeStatus(searchId);
    return;
  }

  await searchService.markRunning(searchId).catch(() => {});

  await withConcurrency(suppliers, config.SEARCH_CONCURRENCY, async (sup) => {
    const t0 = Date.now();

    // ─── 1. Tenta cache (apenas resultados validated com evidência; nunca erros) ──
    let scraped: ScrapedResult | null = null;
    let fromCache = false;
    let scraperStrategy = 'none';

    if (config.ENABLE_SEARCH_CACHE && !forceRefresh) {
      const cached = await cacheService.getSupplierResult<CachedResult>(sup.id, normalizedQuery);
      if (cached && isCacheValid(cached)) {
        scraped = cached;
        fromCache = true;
        scraperStrategy = 'cache';
      }
    }

    // ─── 2. Cache miss → motor universal com fallback automático ──
    let externalStatus: ResultStatus | null = null; // 'timeout' | 'error' (interceptado fora do scraper)
    if (!scraped) {
      try {
        const attempt = await applyTimeout(
          scrapeWithFallback(sup, query, {
            timeoutMs: config.SUPPLIER_TIMEOUT_MS,
            maxCandidates: config.MAX_CANDIDATES_PER_SUPPLIER,
          }),
          config.SUPPLIER_TIMEOUT_MS + 2000,
          sup.name,
        );
        scraped = attempt.result;
        scraperStrategy = attempt.strategy;
      } catch (e) {
        const msg = (e as Error).message ?? '';
        const isTimeout = /tempo esgotado|timed out|abort/i.test(msg);
        externalStatus = isTimeout ? 'timeout' : 'error';
        const friendly = isTimeout
          ? `Timeout no fornecedor ${sup.name}`
          : msg || 'Falha desconhecida no fornecedor';
        scraped = { found: false, status: externalStatus, errorMessage: friendly };
        scraperStrategy = externalStatus;
      }
    }

    // ─── 3. Persiste resultado com status derivado ───────────
    const finalStatus: ResultStatus = externalStatus ?? deriveWorkerStatus({
      fromCache,
      found: scraped.found,
      hasPrice: typeof scraped.price === 'number' && scraped.price > 0,
      hasCurrency: !!scraped.currency,
      scraperStatus: scraped.status,
    });

    const elapsed = Date.now() - t0;
    const errSummary = scraped.errorMessage ? ` | ${scraped.errorMessage.slice(0, 80)}` : '';
    console.log(
      `[worker] ${sup.name} | strategy: ${scraperStrategy} | status: ${finalStatus} | elapsed: ${elapsed}ms${errSummary}`,
    );

    try {
      if (scraped.found && typeof scraped.price === 'number' && scraped.price > 0 && scraped.currency) {
        const { brl, rate } = await searchService.convertToBrl(scraped.price, scraped.currency);
        const freight = scraped.freight ?? 0;
        const totalPrice = parseFloat((scraped.price + freight).toFixed(4));
        const totalBrl = rate > 0
          ? parseFloat((totalPrice * rate).toFixed(4))
          : brl + freight;

        await searchService.insertResult(searchId, sup, {
          found: true,
          status: finalStatus,
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
          linkType: scraped.linkType,
          linkValidated: scraped.linkValidated ?? false,
          evidenceText: scraped.evidenceText,
          sourceUrl: scraped.sourceUrl,
          sourceName: scraped.sourceName,
          validationWarning: scraped.validationWarning,
        });

        // Salva no cache APENAS se resultado passou em todos os critérios de qualidade
        if (!fromCache && isCacheValid(scraped)) {
          const toCache: CachedResult = { ...scraped, cachedAt: new Date().toISOString() };
          void cacheService.setSupplierResult(sup.id, normalizedQuery, toCache)
            .catch((e) => console.warn('[worker] cache set falhou', e));
        }
      } else {
        // ─── REGRA-OURO: jamais inventar preço ──────────
        await searchService.insertResult(searchId, sup, {
          found: false,
          status: finalStatus,
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

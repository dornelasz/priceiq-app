/**
 * Scraper Playwright — ÚLTIMO fallback. Apenas para sites que bloqueiam fetch
 * direto E bloqueiam Jina Reader.
 *
 * Princípios:
 *  - SEM stealth, SEM bypass de captcha, SEM proxy rotativo, SEM truques.
 *  - Se aparecer captcha, Cloudflare challenge ou bloqueio explícito,
 *    retorna status 'blocked' (não tenta contornar).
 *  - Reusa os mesmos extratores (directExtractor + Phase 2) — produto fantasma
 *    continua sendo rejeitado igual em fetch direto / Jina.
 *  - Sempre fecha contexto e página, mesmo em erro.
 *
 * Instalação (opcional):
 *   cd server
 *   npm install playwright
 *   npx playwright install chromium
 *   echo "PLAYWRIGHT_ENABLED=true" >> .env
 *
 * Quando não instalado ou desabilitado, retorna ScrapedResult sem found:true
 * sem quebrar nada — o worker simplesmente vê que Playwright falhou e finaliza
 * o resultado com o status do scraper anterior.
 */
import { config } from '../config.js';
import type { Supplier } from '../services/supplierService.js';
import {
  buildDefaultSearchUrl,
  processSearchContent,
  type ScrapedResult,
  type ScrapeOptions,
} from './jinaReaderScraper.js';

// ─── Tipos mínimos do Playwright (import dinâmico) ───────────────
interface PWPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForLoadState(state: string, opts?: { timeout?: number }): Promise<void>;
  content(): Promise<string>;
  title(): Promise<string>;
  locator(selector: string): { innerText(opts?: { timeout?: number }): Promise<string> };
  close(): Promise<void>;
}
interface PWContext {
  newPage(): Promise<PWPage>;
  close(): Promise<void>;
}
interface PWBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PWContext>;
  isConnected(): boolean;
  close(): Promise<void>;
}
interface PWModule {
  chromium: { launch(opts?: { headless?: boolean }): Promise<PWBrowser> };
}

// ─── Estado interno (cache do browser entre requisições) ─────────
let pwModulePromise: Promise<PWModule | null> | null = null;
let browserPromise: Promise<PWBrowser> | null = null;

async function loadPlaywright(): Promise<PWModule | null> {
  if (!config.PLAYWRIGHT_ENABLED) return null;
  if (pwModulePromise) return pwModulePromise;
  pwModulePromise = (async () => {
    try {
      // Import dinâmico — não quebra se a dep não estiver instalada
      const mod = await import('playwright' as string).catch(() => null);
      if (mod && typeof mod === 'object' && 'chromium' in mod) {
        return mod as PWModule;
      }
      return null;
    } catch {
      return null;
    }
  })();
  return pwModulePromise;
}

async function getBrowser(pw: PWModule): Promise<PWBrowser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
    } catch {
      // browser anterior morreu; relança abaixo
    }
  }
  browserPromise = pw.chromium.launch({ headless: config.PLAYWRIGHT_HEADLESS });
  return browserPromise;
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  if (!config.PLAYWRIGHT_ENABLED) return false;
  const pw = await loadPlaywright();
  return pw !== null;
}

// ─── Detecção de bloqueio (CAPTCHA / Cloudflare challenge) ───────

const CHALLENGE_TITLE_RX =
  /just a moment|attention required|access denied|checking your browser|verify you are human|please verify|cloudflare|are you human|robot check/i;

const CHALLENGE_IFRAME_RX =
  /<iframe[^>]+(?:src|data-src)=["'][^"']*(?:challenges\.cloudflare\.com|google\.com\/recaptcha|hcaptcha\.com)/i;

const CHALLENGE_SCRIPT_RX =
  /(?:challenges\.cloudflare\.com|google\.com\/recaptcha\/api\.js|hcaptcha\.com\/1\/api\.js|cf-chl-bypass|cf-mitigated)/i;

const SHORT_PAGE_CHALLENGE_RX =
  /captcha|verify you|cloudflare|checking your browser|enable javascript and cookies/i;

/**
 * Heurística para detectar bloqueio sem tentar burlar.
 * Sinais fortes:
 *  - Título da página é uma página-desafio conhecida.
 *  - HTML inclui iframe/script de challenges.cloudflare.com / recaptcha / hcaptcha.
 *  - Página muito curta com palavras-chave de desafio.
 */
export function looksBlocked(html: string, textContent: string, title: string): boolean {
  if (title && CHALLENGE_TITLE_RX.test(title)) return true;
  if (html && CHALLENGE_IFRAME_RX.test(html)) return true;
  if (html && CHALLENGE_SCRIPT_RX.test(html)) return true;
  // Página renderizada muito curta com keywords de desafio → bloqueio
  if (textContent && textContent.length < 800 && SHORT_PAGE_CHALLENGE_RX.test(textContent)) return true;
  return false;
}

// ─── Scraper principal ───────────────────────────────────────────

export async function scrapeViaPlaywright(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  if (!config.PLAYWRIGHT_ENABLED) {
    return {
      found: false,
      status: 'error',
      errorMessage: 'Playwright desabilitado (PLAYWRIGHT_ENABLED=false)',
      sourceName: 'playwright-disabled',
    };
  }
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      found: false,
      status: 'error',
      errorMessage: 'Playwright não instalado — execute `npm install playwright && npx playwright install chromium`',
      sourceName: 'playwright-not-installed',
    };
  }

  const searchUrl = buildDefaultSearchUrl(supplier, query);
  // Usa o menor entre o timeout do supplier e o timeout do Playwright
  const totalMs = Math.min(opts.timeoutMs, config.PLAYWRIGHT_TIMEOUT_MS);
  const deadline = Date.now() + totalMs;

  let context: PWContext | null = null;
  let page: PWPage | null = null;

  try {
    const browser = await getBrowser(pw);
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    });
    page = await context.newPage();

    const navTimeout = Math.max(5_000, deadline - Date.now() - 3_000);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });

    // Aguarda networkidle por um curto adicional (não bloqueia se demorar)
    const idleBudget = Math.max(1_000, Math.min(5_000, deadline - Date.now() - 2_000));
    if (idleBudget > 0) {
      await page.waitForLoadState('networkidle', { timeout: idleBudget }).catch(() => {});
    }

    const [html, title, text] = await Promise.all([
      page.content().catch(() => ''),
      page.title().catch(() => ''),
      page.locator('body').innerText({ timeout: 3_000 }).catch(() => ''),
    ]);

    // Detecção de bloqueio antes de extrair — economiza CPU e dá status correto
    if (looksBlocked(html, text, title)) {
      return {
        found: false,
        status: 'blocked',
        errorMessage: 'Fornecedor apresentou captcha/desafio na página renderizada',
        sourceUrl: searchUrl,
        sourceName: 'playwright-blocked',
      };
    }

    if ((html?.length ?? 0) < 200 && (text?.length ?? 0) < 100) {
      return {
        found: false,
        status: 'not_found',
        errorMessage: 'Página renderizada não retornou conteúdo suficiente',
        sourceUrl: searchUrl,
        sourceName: 'playwright-empty',
      };
    }

    // Combina HTML + texto visível — extratores aceitam ambos os formatos
    const combined = `${text}\n\n${html}`;

    // Entrega ao mesmo pipeline anti produto fantasma (Phase 1 + Phase 2 + fallback)
    return await processSearchContent(supplier, query, searchUrl, combined, deadline, 'playwright');
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const isTimeout = /timeout|timed out|navigation timeout/i.test(msg);
    return {
      found: false,
      status: isTimeout ? 'timeout' : 'error',
      errorMessage: `Playwright: ${msg || 'erro desconhecido'}`,
      sourceUrl: searchUrl,
      sourceName: isTimeout ? 'playwright-timeout' : 'playwright-error',
    };
  } finally {
    // Garante limpeza mesmo em erro — browser permanece (cached)
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Helper de testes/teardown: fecha o browser singleton se estiver aberto.
 * Não deve ser chamado em produção (o browser é cacheado para performance).
 */
export async function closePlaywrightBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b.isConnected()) await b.close();
  } catch {
    // ignora
  } finally {
    browserPromise = null;
    pwModulePromise = null;
  }
}

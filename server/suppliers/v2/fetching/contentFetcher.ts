/**
 * ContentFetcher — wrapper HTTP injetável usado pelo AutoConfig (Fase C) e
 * pelo Recipe Runner (Fase D).
 *
 * Princípios:
 *  - Usa SOMENTE fetch nativo (globalThis.fetch).
 *  - NÃO usa Jina, NÃO usa Playwright, NÃO importa scrapers antigos.
 *  - Detecta bloqueio (CAPTCHA / Cloudflare / 4xx específicos) e
 *    requires_login antes de devolver o HTML como 'ok'.
 *  - Timeout via AbortController; default 8s.
 *
 * Interface intencionalmente pequena para tornar mocks de teste triviais.
 */

export type FetcherStatus =
  | 'ok'
  | 'blocked'
  | 'requires_login'
  | 'not_found'
  | 'error';

/** Provider de coleta usado pelo Fetcher em produção. */
export type ContentProvider = 'direct_fetch' | 'firecrawl_scrape';

export interface FetcherResult {
  status: FetcherStatus;
  httpStatus?: number;
  html?: string;
  finalUrl?: string;
  error?: string;
}

export interface Fetcher {
  fetchText(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<FetcherResult>;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

const USER_AGENT =
  'Mozilla/5.0 (compatible; PriceIQ-AutoConfig/1.0; +https://priceiq.app)';

const CHALLENGE_RX =
  /just a moment|attention required|cloudflare|verify you are human|please verify|captcha/i;
const LOGIN_RX =
  /please (?:sign|log) in|você precisa fazer login|entrar para ver pre[çc]os|sign in to see prices/i;

export function createDefaultFetcher(): Fetcher {
  return {
    async fetchText(url, opts) {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: {
            'user-agent': USER_AGENT,
            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          },
        });
        const html = await res.text().catch(() => '');
        clearTimeout(timer);

        if (res.status === 401) {
          return {
            status: 'requires_login',
            httpStatus: 401,
            html,
            finalUrl: res.url,
          };
        }
        if (res.status === 403 || res.status === 429 || res.status === 451) {
          return {
            status: 'blocked',
            httpStatus: res.status,
            html,
            finalUrl: res.url,
          };
        }
        if (res.status === 404) {
          return {
            status: 'not_found',
            httpStatus: 404,
            html,
            finalUrl: res.url,
          };
        }
        if (!res.ok) {
          return {
            status: 'error',
            httpStatus: res.status,
            html,
            finalUrl: res.url,
            error: `HTTP ${res.status}`,
          };
        }
        const peek = html.slice(0, 6000);
        if (CHALLENGE_RX.test(peek)) {
          return {
            status: 'blocked',
            httpStatus: res.status,
            html,
            finalUrl: res.url,
          };
        }
        if (LOGIN_RX.test(peek)) {
          return {
            status: 'requires_login',
            httpStatus: res.status,
            html,
            finalUrl: res.url,
          };
        }
        return { status: 'ok', httpStatus: res.status, html, finalUrl: res.url };
      } catch (e) {
        clearTimeout(timer);
        return { status: 'error', error: (e as Error).message };
      }
    },
  };
}

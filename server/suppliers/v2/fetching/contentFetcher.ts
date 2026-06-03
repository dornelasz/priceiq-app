/**
 * ContentFetcher — wrapper HTTP com cascata: direct → Jina → Firecrawl.
 *
 * Quando o fetch direto é bloqueado ou retorna conteúdo vazio/Cloudflare,
 * tenta Jina Reader (markdown) e depois Firecrawl (markdown) como fallback.
 *
 * O FetcherResult indica `contentType` ('html' ou 'markdown') e `source`
 * ('direct', 'jina', 'firecrawl') para que extractors e recipe runner
 * escolham a estratégia de parsing correta.
 */
import { fetchViaJina } from './jinaFetcher.js';
import { fetchViaFirecrawl } from './firecrawlFetcher.js';

export type FetcherStatus =
  | 'ok'
  | 'blocked'
  | 'requires_login'
  | 'not_found'
  | 'error';

export type ContentType = 'html' | 'markdown';
export type FetchSource = 'direct' | 'jina' | 'firecrawl';

export interface FetcherResult {
  status: FetcherStatus;
  httpStatus?: number;
  html?: string;
  content?: string;
  contentType: ContentType;
  source: FetchSource;
  finalUrl?: string;
  error?: string;
}

export interface FetcherOptions {
  jinaEnabled?: boolean;
  firecrawlEnabled?: boolean;
  firecrawlApiKey?: string;
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

function shouldFallbackToReader(result: FetcherResult): boolean {
  if (result.status === 'blocked') return true;
  if (result.status === 'error') return true;
  if (result.status === 'ok' && result.html && result.html.length < 500) return true;
  return false;
}

async function fetchDirect(
  url: string,
  timeoutMs: number,
): Promise<FetcherResult> {
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
        content: html,
        contentType: 'html',
        source: 'direct',
        finalUrl: res.url,
      };
    }
    if (res.status === 403 || res.status === 429 || res.status === 451) {
      return {
        status: 'blocked',
        httpStatus: res.status,
        html,
        content: html,
        contentType: 'html',
        source: 'direct',
        finalUrl: res.url,
      };
    }
    if (res.status === 404) {
      return {
        status: 'not_found',
        httpStatus: 404,
        html,
        content: html,
        contentType: 'html',
        source: 'direct',
        finalUrl: res.url,
      };
    }
    if (!res.ok) {
      return {
        status: 'error',
        httpStatus: res.status,
        html,
        content: html,
        contentType: 'html',
        source: 'direct',
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
        content: html,
        contentType: 'html',
        source: 'direct',
        finalUrl: res.url,
      };
    }
    if (LOGIN_RX.test(peek)) {
      return {
        status: 'requires_login',
        httpStatus: res.status,
        html,
        content: html,
        contentType: 'html',
        source: 'direct',
        finalUrl: res.url,
      };
    }
    return {
      status: 'ok',
      httpStatus: res.status,
      html,
      content: html,
      contentType: 'html',
      source: 'direct',
      finalUrl: res.url,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      status: 'error',
      contentType: 'html',
      source: 'direct',
      error: (e as Error).message,
    };
  }
}

export function createDefaultFetcher(opts?: FetcherOptions): Fetcher {
  const jinaEnabled = opts?.jinaEnabled ?? true;
  const firecrawlEnabled = opts?.firecrawlEnabled ?? false;
  const firecrawlApiKey = opts?.firecrawlApiKey ?? '';

  return {
    async fetchText(url, fetchOpts) {
      const timeoutMs = fetchOpts?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

      // 1. Fetch direto
      const directResult = await fetchDirect(url, timeoutMs);

      if (directResult.status === 'ok' && !shouldFallbackToReader(directResult)) {
        return directResult;
      }
      if (directResult.status === 'not_found') {
        return directResult;
      }
      if (directResult.status === 'requires_login') {
        return directResult;
      }

      // 2. Jina Reader (markdown)
      if (jinaEnabled) {
        const jina = await fetchViaJina(url, timeoutMs);
        if (jina.ok) {
          return {
            status: 'ok',
            html: jina.markdown,
            content: jina.markdown,
            contentType: 'markdown',
            source: 'jina',
            finalUrl: url,
          };
        }
      }

      // 3. Firecrawl (markdown)
      if (firecrawlEnabled && firecrawlApiKey) {
        const fc = await fetchViaFirecrawl(url, firecrawlApiKey, timeoutMs);
        if (fc.ok) {
          return {
            status: 'ok',
            html: fc.markdown,
            content: fc.markdown,
            contentType: 'markdown',
            source: 'firecrawl',
            finalUrl: url,
          };
        }
      }

      // Todos falharam — retorna o resultado do fetch direto
      return directResult;
    },
  };
}

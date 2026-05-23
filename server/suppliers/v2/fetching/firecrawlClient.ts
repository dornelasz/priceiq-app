/**
 * Firecrawl API v1 — wrapper HTTP puro.
 *
 * Responsabilidades:
 *  - Faz a única chamada real à API Firecrawl (POST /v1/scrape).
 *  - NUNCA expõe FIRECRAWL_API_KEY: a chave é recebida por parâmetro.
 *  - Todos os erros (rede, HTTP, resposta inválida, timeout) são mapeados
 *    para FirecrawlResult.status — nunca lança exceção para o caller.
 *  - Não importa nenhum módulo de scraping legado, cotação ou searchService.
 *
 * Usado SOMENTE por firecrawlFetcher.ts. Código de negócio não importa
 * este módulo diretamente.
 */

export interface FirecrawlScrapeOptions {
  url: string;
  /** Timeout em ms para o HTTP call à API Firecrawl (default 30 s). */
  timeoutMs?: number;
  formats?: ('html' | 'markdown')[];
}

export interface FirecrawlResult {
  status: 'ok' | 'blocked' | 'rate_limited' | 'auth_error' | 'timeout' | 'error';
  html?: string;
  markdown?: string;
  finalUrl?: string;
  httpStatus?: number;
  error?: string;
}

interface FirecrawlApiResponse {
  success: boolean;
  data?: {
    html?: string;
    markdown?: string;
    metadata?: {
      statusCode?: number;
      url?: string;
      title?: string;
    };
  };
  error?: string;
}

export interface FirecrawlClientInstance {
  scrape(opts: FirecrawlScrapeOptions): Promise<FirecrawlResult>;
}

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param apiKey FIRECRAWL_API_KEY — deve vir de process.env, nunca hardcoded.
 * @param baseUrl Override para instância self-hosted (default: api.firecrawl.dev).
 */
export function createFirecrawlClient(
  apiKey: string,
  baseUrl = FIRECRAWL_BASE,
): FirecrawlClientInstance {
  return {
    async scrape(opts) {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch(`${baseUrl}/v1/scrape`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url: opts.url,
            formats: opts.formats ?? ['html'],
          }),
        });
        clearTimeout(timer);

        if (res.status === 401 || res.status === 403) {
          return {
            status: 'auth_error',
            httpStatus: res.status,
            error: 'Firecrawl: API key inválida ou sem permissão',
          };
        }
        if (res.status === 429) {
          return {
            status: 'rate_limited',
            httpStatus: 429,
            error: 'Firecrawl: rate limit atingido',
          };
        }
        if (!res.ok) {
          return {
            status: 'error',
            httpStatus: res.status,
            error: `Firecrawl: HTTP ${res.status}`,
          };
        }

        let body: FirecrawlApiResponse;
        try {
          body = (await res.json()) as FirecrawlApiResponse;
        } catch {
          return { status: 'error', error: 'Firecrawl: resposta não é JSON válido' };
        }

        if (!body.success || !body.data) {
          return {
            status: 'error',
            error: body.error ?? 'Firecrawl: success=false sem mensagem de erro',
          };
        }

        const html = body.data.html ?? '';
        const markdown = body.data.markdown;
        const finalUrl = body.data.metadata?.url ?? opts.url;
        const httpStatus = body.data.metadata?.statusCode ?? 200;

        // Firecrawl executou, mas o destino respondeu com código de bloqueio.
        if (httpStatus === 403 || httpStatus === 429 || httpStatus === 451) {
          return { status: 'blocked', httpStatus, html, finalUrl };
        }
        if (httpStatus === 401) {
          return {
            status: 'auth_error',
            httpStatus,
            error: 'Destino exige autenticação',
          };
        }

        return { status: 'ok', html, markdown, finalUrl, httpStatus };
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).message ?? 'erro desconhecido';
        if (/abort|AbortError/i.test(msg) || /abort/i.test((e as { name?: string }).name ?? '')) {
          return { status: 'timeout', error: `Firecrawl timeout após ${timeoutMs}ms` };
        }
        return { status: 'error', error: `Firecrawl: ${msg}` };
      }
    },
  };
}

/**
 * FirecrawlProvider — coletor de páginas via Firecrawl API v2 (Etapa 11).
 *
 * Implementa o contrato FetchProvider. É o coletor PRINCIPAL quando
 * FIRECRAWL_ENABLED=true, porque os sites-alvo bloqueiam o fetch direto
 * (Etapa 10: Kabum, Pichau, TerabyteShop, Magalu, AliExpress → HTTP 403).
 *
 * Princípios e garantias:
 *   - Chama SOMENTE o endpoint /scrape da API Firecrawl v2 (POST).
 *   - NÃO usa schema JSON, NÃO usa LLM do Firecrawl, NÃO usa actions/interact.
 *   - Pede formats ["markdown","html","links"] — o PriceIQ continua sendo o
 *     motor: a extração/validação de preço é do localProductExtractor.
 *   - A FIRECRAWL_API_KEY chega por parâmetro e vai SOMENTE no header
 *     Authorization — nunca aparece em logs, no resultado ou em diagnostics.
 *   - NUNCA lança: toda falha (rede, HTTP, timeout, JSON inválido) vira um
 *     FetchProviderStatus controlado.
 *
 * Mapeamento de status:
 *   API 401            → error   (chave inválida — sem vazar a chave)
 *   API 402            → no_credits
 *   API 429            → rate_limited
 *   API 408/504/abort  → timeout
 *   API outro !ok      → error
 *   success=false      → error
 *   destino 403/429/451→ blocked
 *   destino 404        → not_found
 *   challenge no HTML  → blocked
 *   caso contrário     → success (html + markdown + links + finalUrl)
 */
import type {
  FetchProvider,
  FetchProviderInput,
  FetchProviderResult,
} from './fetchProvider.js';

const CHALLENGE_RX =
  /just a moment|attention required|cloudflare|verify you are human|please verify|captcha/i;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FirecrawlProviderOptions {
  /** FIRECRAWL_API_KEY — vem de process.env, nunca hardcoded. */
  apiKey: string;
  /** Endpoint base da API v2 (default: https://api.firecrawl.dev/v2). */
  apiUrl?: string;
  /** Timeout do scrape em ms (default 60000). */
  timeoutMs?: number;
  /** waitFor em ms repassado ao Firecrawl (default 1000). */
  waitForMs?: number;
  enabled?: boolean;
}

interface FirecrawlV2Response {
  success?: boolean;
  error?: string;
  data?: {
    html?: string;
    markdown?: string;
    links?: string[];
    metadata?: {
      statusCode?: number;
      url?: string;
      sourceURL?: string;
      title?: string;
    };
  };
}

const DEFAULT_API_URL = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_FOR_MS = 1000;

/**
 * Monta o payload de scrape (exposto para teste de payload).
 * Sem schema JSON, sem LLM, sem actions.
 */
export function buildFirecrawlScrapePayload(
  url: string,
  timeoutMs: number,
  waitForMs: number,
): Record<string, unknown> {
  return {
    url,
    formats: ['markdown', 'html', 'links'],
    onlyMainContent: true,
    timeout: timeoutMs,
    waitFor: waitForMs,
    blockAds: true,
    proxy: 'auto',
    storeInCache: true,
    maxAge: 3_600_000,
  };
}

export function createFirecrawlProvider(
  options: FirecrawlProviderOptions,
): FetchProvider {
  const apiKey = options.apiKey;
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const waitForMs = options.waitForMs ?? DEFAULT_WAIT_FOR_MS;
  const enabled = options.enabled ?? true;

  return {
    name: 'firecrawl',
    type: 'firecrawl',
    enabled,
    async fetchPage(input: FetchProviderInput): Promise<FetchProviderResult> {
      const t0 = Date.now();
      const elapsed = () => Date.now() - t0;

      if (!enabled) {
        return { status: 'disabled', url: input.url, errorMessage: 'firecrawl_disabled', elapsedMs: 0 };
      }
      if (!apiKey) {
        return {
          status: 'error',
          url: input.url,
          errorMessage: 'firecrawl_api_key_missing',
          elapsedMs: elapsed(),
        };
      }

      const timeoutMs = input.timeoutMs ?? defaultTimeout;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch(`${apiUrl}/scrape`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(
            buildFirecrawlScrapePayload(input.url, timeoutMs, waitForMs),
          ),
        });
        clearTimeout(timer);

        // ── Erros HTTP da própria API Firecrawl ────────────────────────────
        if (res.status === 401) {
          return {
            status: 'error',
            url: input.url,
            httpStatus: 401,
            errorMessage: 'firecrawl: chave inválida ou sem permissão',
            elapsedMs: elapsed(),
          };
        }
        if (res.status === 402) {
          return {
            status: 'no_credits',
            url: input.url,
            httpStatus: 402,
            errorMessage: 'firecrawl: sem créditos',
            elapsedMs: elapsed(),
          };
        }
        if (res.status === 429) {
          return {
            status: 'rate_limited',
            url: input.url,
            httpStatus: 429,
            errorMessage: 'firecrawl: limite de requisições atingido',
            elapsedMs: elapsed(),
          };
        }
        if (res.status === 408 || res.status === 504) {
          return {
            status: 'timeout',
            url: input.url,
            httpStatus: res.status,
            errorMessage: 'firecrawl: timeout da API',
            elapsedMs: elapsed(),
          };
        }
        if (!res.ok) {
          return {
            status: 'error',
            url: input.url,
            httpStatus: res.status,
            errorMessage: `firecrawl: HTTP ${res.status}`,
            elapsedMs: elapsed(),
          };
        }

        let body: FirecrawlV2Response;
        try {
          body = (await res.json()) as FirecrawlV2Response;
        } catch {
          return {
            status: 'error',
            url: input.url,
            errorMessage: 'firecrawl: resposta não é JSON válido',
            elapsedMs: elapsed(),
          };
        }

        if (!body.success || !body.data) {
          return {
            status: 'error',
            url: input.url,
            errorMessage: body.error ?? 'firecrawl: success=false sem mensagem',
            elapsedMs: elapsed(),
          };
        }

        const html = body.data.html ?? '';
        const markdown = body.data.markdown;
        const links = Array.isArray(body.data.links) ? body.data.links : undefined;
        const finalUrl =
          body.data.metadata?.url ?? body.data.metadata?.sourceURL ?? input.url;
        const destStatus = body.data.metadata?.statusCode ?? 200;

        // ── Resultado do DESTINO (Firecrawl executou, o site respondeu) ────
        if (destStatus === 403 || destStatus === 429 || destStatus === 451) {
          return {
            status: 'blocked',
            url: input.url,
            finalUrl,
            httpStatus: destStatus,
            errorMessage: 'destino bloqueou o acesso',
            elapsedMs: elapsed(),
          };
        }
        if (destStatus === 404) {
          return {
            status: 'not_found',
            url: input.url,
            finalUrl,
            httpStatus: destStatus,
            elapsedMs: elapsed(),
          };
        }

        const peek = (markdown || html).slice(0, 6000);
        if (CHALLENGE_RX.test(peek)) {
          return {
            status: 'blocked',
            url: input.url,
            finalUrl,
            httpStatus: destStatus,
            errorMessage: 'desafio anti-bot detectado no conteúdo',
            elapsedMs: elapsed(),
          };
        }

        return {
          status: 'success',
          url: input.url,
          finalUrl,
          html,
          markdown,
          text: html ? stripTags(html) : markdown,
          links,
          httpStatus: destStatus,
          elapsedMs: elapsed(),
        };
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).message ?? 'erro desconhecido';
        const name = (e as { name?: string }).name ?? '';
        if (/abort/i.test(name) || /abort|timeout/i.test(msg)) {
          return {
            status: 'timeout',
            url: input.url,
            errorMessage: `firecrawl: timeout após ${timeoutMs}ms`,
            elapsedMs: elapsed(),
          };
        }
        return {
          status: 'error',
          url: input.url,
          errorMessage: `firecrawl: ${msg}`,
          elapsedMs: elapsed(),
        };
      }
    },
  };
}

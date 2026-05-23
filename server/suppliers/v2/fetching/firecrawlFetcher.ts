/**
 * FirecrawlFetcher — implementa a interface Fetcher usando Firecrawl,
 * e expõe createFetcherForConfig para o worker selecionar o provider certo.
 *
 * Modos de operação (FIRECRAWL_MODE):
 *
 *  'preferred':
 *    Firecrawl é chamado primeiro. Se a API Firecrawl falhar por razão
 *    interna (auth_error, rate_limited, erro de rede, timeout de API),
 *    cai para direct_fetch como safety net. Se o DESTINO bloquear o
 *    Firecrawl (blocked/requires_login), retorna blocked — não há fallback.
 *
 *  'fallback' (default):
 *    direct_fetch é tentado primeiro. Firecrawl entra apenas quando
 *    direct_fetch retorna 'blocked' ou 'error'. 'not_found' e
 *    'requires_login' são conclusivos — Firecrawl não ajuda.
 *
 * Garantias:
 *  - FIRECRAWL_API_KEY nunca aparece em logs ou no resultado devolvido.
 *  - Timeout de Firecrawl → status 'error' com 'timeout' na mensagem
 *    (fetchStatusToResultStatus no recipeRunner.ts mapeia para 'timeout').
 *  - Bloqueio do destino → status 'blocked', jamais lança exceção.
 *  - Frete desconhecido NUNCA vira 0 — este fetcher só devolve HTML;
 *    a lógica de frete está em recipeRunner/resultBuilder.
 *  - Se FIRECRAWL_API_KEY estiver vazia, createFetcherForConfig retorna
 *    createDefaultFetcher() sem qualquer chamada Firecrawl.
 */

import {
  createDefaultFetcher,
  DEFAULT_FETCH_TIMEOUT_MS,
  type Fetcher,
  type FetcherResult,
} from './contentFetcher.js';
import { createFirecrawlClient } from './firecrawlClient.js';

// Reutiliza os mesmos padrões do contentFetcher para consistência.
const CHALLENGE_RX =
  /just a moment|attention required|cloudflare|verify you are human|please verify|captcha/i;
const LOGIN_RX =
  /please (?:sign|log) in|você precisa fazer login|entrar para ver pre[çc]os|sign in to see prices/i;

function htmlToFetcherResult(
  html: string,
  finalUrl: string | undefined,
  httpStatus: number | undefined,
): FetcherResult {
  if (!html || html.length < 50) {
    return { status: 'error', error: 'Firecrawl retornou HTML vazio' };
  }
  const peek = html.slice(0, 6000);
  if (CHALLENGE_RX.test(peek)) {
    return { status: 'blocked', httpStatus, html, finalUrl };
  }
  if (LOGIN_RX.test(peek)) {
    return { status: 'requires_login', httpStatus, html, finalUrl };
  }
  return { status: 'ok', httpStatus, html, finalUrl };
}

/**
 * Cria um Fetcher que roteia 100% das requisições pelo Firecrawl.
 * Erros de API (auth, rate limit, rede) → status 'error' ou 'blocked'.
 */
export function createFirecrawlFetcher(apiKey: string, baseUrl?: string): Fetcher {
  const client = createFirecrawlClient(apiKey, baseUrl);
  return {
    async fetchText(url, opts): Promise<FetcherResult> {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
      const res = await client.scrape({ url, timeoutMs, formats: ['html'] });

      if (res.status === 'timeout') {
        // Mensagem contém 'timeout' para que fetchStatusToResultStatus
        // no recipeRunner mapeie corretamente para SearchResultStatusV2='timeout'.
        return { status: 'error', error: res.error ?? `Firecrawl timeout após ${timeoutMs}ms` };
      }
      if (res.status === 'auth_error') {
        // API key inválida — erro de infra, não do destino.
        return { status: 'error', error: res.error };
      }
      if (res.status === 'rate_limited') {
        // Rate limit → blocked (semanticamente: acesso temporariamente impedido).
        return { status: 'blocked', httpStatus: 429, error: res.error };
      }
      if (res.status === 'blocked') {
        return { status: 'blocked', httpStatus: res.httpStatus, error: res.error };
      }
      if (res.status === 'error') {
        return { status: 'error', error: res.error };
      }

      // status === 'ok' — avalia o HTML retornado.
      return htmlToFetcherResult(res.html ?? '', res.finalUrl, res.httpStatus);
    },
  };
}

// ─── Config-driven factory ────────────────────────────────────────────────

export interface FetcherConfig {
  /** FIRECRAWL_API_KEY — vem de process.env. Vazia = Firecrawl desativado. */
  firecrawlApiKey: string;
  /** 'preferred' | 'fallback'. Default: 'fallback'. */
  firecrawlMode: 'preferred' | 'fallback';
  /** Override da URL base do Firecrawl (self-hosted). */
  firecrawlBaseUrl?: string;
}

/**
 * Retorna o Fetcher correto com base na configuração do ambiente.
 *
 *  - apiKey vazia → createDefaultFetcher() (Firecrawl desativado).
 *  - mode='preferred' → Firecrawl primeiro; direct_fetch se API Firecrawl falhar.
 *  - mode='fallback'  → direct_fetch primeiro; Firecrawl se blocked ou error.
 */
export function createFetcherForConfig(cfg: FetcherConfig): Fetcher {
  const { firecrawlApiKey: apiKey, firecrawlMode: mode, firecrawlBaseUrl: fcBase } = cfg;

  if (!apiKey) {
    return createDefaultFetcher();
  }

  const directFetcher = createDefaultFetcher();
  const fcFetcher = createFirecrawlFetcher(apiKey, fcBase);

  if (mode === 'preferred') {
    return {
      async fetchText(url, opts): Promise<FetcherResult> {
        const fcRes = await fcFetcher.fetchText(url, opts);
        // Resultado conclusivo do destino (ok, blocked, requires_login):
        // Firecrawl conseguiu acessar o site, resultado é definitivo.
        if (
          fcRes.status === 'ok' ||
          fcRes.status === 'blocked' ||
          fcRes.status === 'requires_login'
        ) {
          return fcRes;
        }
        // Firecrawl falhou por razão de API (auth, rate_limit, erro de rede).
        // direct_fetch como safety net.
        console.warn(
          `[firecrawl] preferred: API falhou (${fcRes.error}), tentando direct_fetch`,
        );
        return directFetcher.fetchText(url, opts);
      },
    };
  }

  // mode === 'fallback': direct_fetch primeiro; Firecrawl em blocked/error.
  return {
    async fetchText(url, opts): Promise<FetcherResult> {
      const directRes = await directFetcher.fetchText(url, opts);
      if (
        directRes.status === 'ok' ||
        directRes.status === 'requires_login' ||
        directRes.status === 'not_found'
      ) {
        // Resultado conclusivo — Firecrawl não muda o outcome.
        return directRes;
      }
      // blocked ou error → Firecrawl pode penetrar proteções do destino.
      console.warn(
        `[firecrawl] fallback: direct_fetch '${directRes.status}', tentando Firecrawl`,
      );
      return fcFetcher.fetchText(url, opts);
    },
  };
}

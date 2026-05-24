/**
 * NativeFetcher — provider de coleta PRINCIPAL do motor próprio (Etapa 5).
 *
 * Usa exclusivamente o fetch nativo (via createDefaultFetcher do V2), sem
 * qualquer serviço externo. É o provider de maior prioridade: o motor próprio
 * sempre tenta por aqui primeiro. Detecta bloqueio/login/timeout reaproveitando
 * a lógica já testada do contentFetcher — sem duplicar regex de challenge.
 *
 * Converte o `FetcherResult` (contrato de fetching) para `FetchProviderResult`
 * (contrato do motor), preenchendo também `text` (HTML sem tags) e medindo
 * `elapsedMs`. NUNCA lança — falhas viram status do contrato.
 */
import {
  createDefaultFetcher,
  type Fetcher,
  type FetcherResult,
} from '../../fetching/contentFetcher.js';
import type {
  FetchProvider,
  FetchProviderInput,
  FetchProviderResult,
  FetchProviderStatus,
} from './fetchProvider.js';

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapStatus(res: FetcherResult): FetchProviderStatus {
  switch (res.status) {
    case 'ok':
      return 'success';
    case 'blocked':
      return 'blocked';
    case 'requires_login':
      // O contrato do motor não tem requires_login — bloqueio é o mais próximo.
      return 'blocked';
    case 'not_found':
      return 'not_found';
    case 'error':
    default:
      return /timeout|abort|tempo esgotado/i.test(res.error ?? '')
        ? 'timeout'
        : 'error';
  }
}

function adaptResult(
  res: FetcherResult,
  url: string,
  elapsedMs: number,
): FetchProviderResult {
  const status = mapStatus(res);
  const html = res.html;
  return {
    status,
    url,
    finalUrl: res.finalUrl,
    html,
    text: html ? stripTags(html) : undefined,
    httpStatus: res.httpStatus,
    errorMessage: res.error,
    elapsedMs,
  };
}

export interface NativeFetchProviderOptions {
  /** Fetcher injetável (testes). Default: createDefaultFetcher() (fetch nativo). */
  fetcher?: Fetcher;
  /** Permite desligar o provider explicitamente. Default: true (ligado). */
  enabled?: boolean;
}

/**
 * Cria o FetchProvider nativo. Em produção usa fetch nativo; em testes aceita
 * um Fetcher fake injetado.
 */
export function createNativeFetchProvider(
  options: NativeFetchProviderOptions = {},
): FetchProvider {
  const fetcher = options.fetcher ?? createDefaultFetcher();
  const enabled = options.enabled ?? true;

  return {
    name: 'native_fetch',
    type: 'native',
    enabled,
    async fetchPage(input: FetchProviderInput): Promise<FetchProviderResult> {
      const t0 = Date.now();
      if (!enabled) {
        return {
          status: 'disabled',
          url: input.url,
          errorMessage: 'native_fetcher_disabled',
          elapsedMs: 0,
        };
      }
      try {
        const res = await fetcher.fetchText(input.url, {
          timeoutMs: input.timeoutMs,
        });
        return adaptResult(res, input.url, Date.now() - t0);
      } catch (e) {
        const msg = (e as Error).message ?? 'native fetch falhou';
        return {
          status: /timeout|abort/i.test(msg) ? 'timeout' : 'error',
          url: input.url,
          errorMessage: msg,
          elapsedMs: Date.now() - t0,
        };
      }
    },
  };
}

/**
 * SearchAttempt — registro de diagnóstico em memória do motor próprio (Etapa 5).
 *
 * Cada passo relevante do pipeline (achar candidato, fetch nativo, extração,
 * validação, rejeição) vira um SearchAttempt. A coleção fica no
 * SearchEngineContext.diagnostics e serve para depuração e observabilidade —
 * NÃO é persistida nesta etapa.
 *
 * Funções PURAS.
 */
import type { SearchEngineInternalStatus } from '../core/searchEngineStatus.js';

export interface SearchAttempt {
  /** Passo do pipeline: ex 'candidate', 'native_fetch', 'extraction', 'match'. */
  step: string;
  status: SearchEngineInternalStatus;
  providerName?: string;
  url?: string;
  detail?: string;
  elapsedMs?: number;
  /** Status HTTP observado (do provider ou do destino). */
  httpStatus?: number;
  /** Este passo foi servido por um provider de fallback? */
  usedFallback?: boolean;
  /** Por que caiu para fallback (ex: 'firecrawl:no_credits'). */
  fallbackReason?: string;
  /** Quantidade de links que o provider trouxe (ex: Firecrawl). */
  linksFromProvider?: number;
  /** ISO timestamp do registro. */
  at: string;
}

export interface MakeSearchAttemptInput {
  step: string;
  status: SearchEngineInternalStatus;
  providerName?: string;
  url?: string;
  detail?: string;
  elapsedMs?: number;
  httpStatus?: number;
  usedFallback?: boolean;
  fallbackReason?: string;
  linksFromProvider?: number;
}

/** Cria um SearchAttempt carimbado com o instante atual. */
export function makeSearchAttempt(input: MakeSearchAttemptInput): SearchAttempt {
  return {
    step: input.step,
    status: input.status,
    providerName: input.providerName,
    url: input.url,
    detail: input.detail,
    elapsedMs: input.elapsedMs,
    httpStatus: input.httpStatus,
    usedFallback: input.usedFallback,
    fallbackReason: input.fallbackReason,
    linksFromProvider: input.linksFromProvider,
    at: new Date().toISOString(),
  };
}

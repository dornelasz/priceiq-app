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
    at: new Date().toISOString(),
  };
}

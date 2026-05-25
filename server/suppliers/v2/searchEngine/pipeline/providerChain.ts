/**
 * providerChain — coleta uma URL tentando vários providers em ordem de
 * prioridade, com fallback controlado (Etapa 11).
 *
 * Quando o Firecrawl está ligado, a ordem é [firecrawl, native]: tenta o
 * Firecrawl primeiro (o site bloqueia o fetch direto) e cai para o
 * NativeFetcher se o Firecrawl falhar por razão de API (rate_limited,
 * no_credits, timeout, error) ou bloqueio. O PRIMEIRO success vence.
 *
 * Cada tentativa:
 *   - respeita o orçamento (fetch/elapsed + nativeFetch OU externalFetch +
 *     firecrawlCall + créditos estimados);
 *   - registra um SearchAttempt com providerName, httpStatus, usedFallback e
 *     fallbackReason.
 *
 * NUNCA lança (os providers já são à prova de exceção). Funções de orçamento
 * mutam o contexto via consumeBudget.
 */
import {
  addDiagnosticAttempt,
  type SearchEngineContext,
} from '../core/searchEngineContext.js';
import {
  hasBudgetRemaining,
  consumeBudget,
  hasFirecrawlCreditsRemaining,
  consumeFirecrawlCredits,
} from '../core/searchBudget.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchEngineInternalStatus } from '../core/searchEngineStatus.js';
import type {
  FetchProvider,
  FetchProviderInput,
  FetchProviderResult,
  FetchProviderStatus,
} from '../providers/fetchProvider.js';

/** Prioridade para escolher a "melhor" falha a reportar quando todos falham. */
const FAILURE_RANK: Record<FetchProviderStatus, number> = {
  blocked: 5,
  timeout: 4,
  no_credits: 3,
  rate_limited: 3,
  not_found: 2,
  error: 1,
  success: 1, // success sem html é tratado como falha técnica
  disabled: 0,
};

export interface ProviderChainResult {
  result: FetchProviderResult;
  providerName: string | null;
  usedFallback: boolean;
  fallbackReason?: string;
  triedCount: number;
}

function fetchStatusToInternal(
  type: FetchProvider['type'],
  status: FetchProviderStatus,
): SearchEngineInternalStatus {
  if (status === 'success') {
    return type === 'native' ? 'native_fetch_success' : 'external_fetch_success';
  }
  if (status === 'blocked') return 'blocked';
  if (status === 'timeout') return 'timeout';
  return type === 'native' ? 'native_fetch_failed' : 'external_fetch_failed';
}

/** Há orçamento para tentar este provider AGORA? */
export function canProviderFetch(
  provider: FetchProvider,
  context: SearchEngineContext,
): boolean {
  if (!provider.enabled) return false;
  if (!hasBudgetRemaining(context, 'fetch')) return false;
  if (!hasBudgetRemaining(context, 'elapsed')) return false;
  if (provider.type === 'native') {
    return hasBudgetRemaining(context, 'nativeFetch');
  }
  return (
    hasBudgetRemaining(context, 'externalFetch') &&
    hasBudgetRemaining(context, 'firecrawlCall') &&
    hasFirecrawlCreditsRemaining(context)
  );
}

/** Algum provider da lista tem orçamento para tentar agora? */
export function anyProviderCanFetch(
  providers: FetchProvider[],
  context: SearchEngineContext,
): boolean {
  return providers.some((p) => canProviderFetch(p, context));
}

function consumeFor(provider: FetchProvider, context: SearchEngineContext): void {
  consumeBudget(context, 'fetch');
  if (provider.type === 'native') {
    consumeBudget(context, 'nativeFetch');
  } else {
    consumeBudget(context, 'externalFetch');
    consumeBudget(context, 'firecrawlCall');
    consumeFirecrawlCredits(context);
  }
}

/**
 * Tenta coletar `fetchInput.url` pelos providers em ordem, com fallback.
 * Registra cada tentativa no diagnostics do contexto sob o `step` dado.
 */
export async function fetchThroughProviders(
  providers: FetchProvider[],
  fetchInput: FetchProviderInput,
  context: SearchEngineContext,
  step: string,
): Promise<ProviderChainResult> {
  let chosenFailure: { result: FetchProviderResult; providerName: string } | null = null;
  let fallbackReason: string | undefined;
  let triedCount = 0;

  for (const provider of providers) {
    if (!canProviderFetch(provider, context)) continue;
    consumeFor(provider, context);
    triedCount += 1;
    const usedFallback = triedCount > 1;

    const result = await provider.fetchPage(fetchInput);
    const isSuccess = result.status === 'success' && !!result.html;
    const internal = isSuccess
      ? fetchStatusToInternal(provider.type, 'success')
      : fetchStatusToInternal(provider.type, result.status === 'success' ? 'error' : result.status);

    addDiagnosticAttempt(
      context,
      makeSearchAttempt({
        step,
        status: internal,
        providerName: provider.name,
        url: fetchInput.url,
        httpStatus: result.httpStatus,
        detail: result.errorMessage,
        elapsedMs: result.elapsedMs,
        usedFallback,
        fallbackReason: usedFallback ? fallbackReason : undefined,
        linksFromProvider: result.links?.length,
      }),
    );

    if (isSuccess) {
      return {
        result,
        providerName: provider.name,
        usedFallback,
        fallbackReason: usedFallback ? fallbackReason : undefined,
        triedCount,
      };
    }

    // Falha → prepara fallbackReason para o próximo provider e guarda a melhor falha.
    fallbackReason = `${provider.name}:${result.status}`;
    const normalizedFailure: FetchProviderResult =
      result.status === 'success'
        ? { ...result, status: 'error', errorMessage: result.errorMessage ?? 'conteúdo vazio' }
        : result;
    const rank = FAILURE_RANK[normalizedFailure.status] ?? 0;
    const prevRank = chosenFailure ? (FAILURE_RANK[chosenFailure.result.status] ?? 0) : -1;
    if (!chosenFailure || rank > prevRank) {
      chosenFailure = { result: normalizedFailure, providerName: provider.name };
    }
  }

  if (chosenFailure) {
    return {
      result: chosenFailure.result,
      providerName: chosenFailure.providerName,
      usedFallback: triedCount > 1,
      fallbackReason: triedCount > 1 ? fallbackReason : undefined,
      triedCount,
    };
  }

  // Nenhum provider pôde sequer ser tentado (orçamento esgotado).
  return {
    result: {
      status: 'error',
      url: fetchInput.url,
      errorMessage: 'nenhum provider de coleta disponível (orçamento esgotado)',
      elapsedMs: 0,
    },
    providerName: null,
    usedFallback: false,
    triedCount: 0,
  };
}

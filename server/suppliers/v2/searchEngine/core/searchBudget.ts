/**
 * SearchBudget — orçamento do motor próprio de busca (Etapa 5 — fundação).
 *
 * O orçamento limita quantas operações caras o motor pode gastar por
 * fornecedor: URLs candidatas, fetches, tentativas de extração, tempo total,
 * e — crucialmente — fetches externos (Firecrawl) e chamadas de IA.
 *
 * Defaults desta etapa (motor próprio é prioridade absoluta):
 *   - maxExternalFetches = 0  → Firecrawl nunca roda por orçamento.
 *   - maxAiCalls         = 0  → IA nunca roda por orçamento.
 *
 * As funções operam sobre qualquer objeto que carregue { budget, budgetUsage,
 * startedAt } (BudgetBearer) — o SearchEngineContext satisfaz isso
 * estruturalmente, evitando dependência circular com searchEngineContext.ts.
 *
 * Funções PURAS exceto `consumeBudget`, que muta `budgetUsage` (contador).
 */

/** Tipos de recurso controlados pelo orçamento. */
export type BudgetKind =
  | 'candidateUrl'
  | 'fetch'
  | 'extraction'
  | 'nativeFetch'
  | 'externalFetch'
  | 'aiCall'
  | 'elapsed';

export interface SearchBudget {
  maxCandidateUrls: number;
  maxFetchesPerSupplier: number;
  maxExtractionAttempts: number;
  maxElapsedMs: number;
  maxNativeFetches: number;
  /** Fetches por provider externo (Firecrawl). Default 0 nesta etapa. */
  maxExternalFetches: number;
  /** Chamadas de IA. Default 0 nesta etapa. */
  maxAiCalls: number;
}

export interface BudgetUsage {
  candidateUrls: number;
  fetches: number;
  extractions: number;
  nativeFetches: number;
  externalFetches: number;
  aiCalls: number;
}

export interface BudgetBearer {
  budget: SearchBudget;
  budgetUsage: BudgetUsage;
  startedAt: number;
}

/**
 * Orçamento padrão. Externo e IA ZERADOS — o motor próprio (native + extrator
 * local da Etapa 4) é a única via habilitada por padrão.
 */
export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  maxCandidateUrls: 5,
  maxFetchesPerSupplier: 6,
  maxExtractionAttempts: 6,
  maxElapsedMs: 30000,
  maxNativeFetches: 6,
  maxExternalFetches: 0,
  maxAiCalls: 0,
};

/** Cria um contador de uso zerado. */
export function createBudgetUsage(): BudgetUsage {
  return {
    candidateUrls: 0,
    fetches: 0,
    extractions: 0,
    nativeFetches: 0,
    externalFetches: 0,
    aiCalls: 0,
  };
}

/** Resolve um orçamento completo a partir de um override parcial. */
export function resolveBudget(partial?: Partial<SearchBudget>): SearchBudget {
  return { ...DEFAULT_SEARCH_BUDGET, ...(partial ?? {}) };
}

function limitFor(budget: SearchBudget, kind: BudgetKind): number {
  switch (kind) {
    case 'candidateUrl':
      return budget.maxCandidateUrls;
    case 'fetch':
      return budget.maxFetchesPerSupplier;
    case 'extraction':
      return budget.maxExtractionAttempts;
    case 'nativeFetch':
      return budget.maxNativeFetches;
    case 'externalFetch':
      return budget.maxExternalFetches;
    case 'aiCall':
      return budget.maxAiCalls;
    case 'elapsed':
      return budget.maxElapsedMs;
  }
}

function usageFor(usage: BudgetUsage, kind: BudgetKind): number {
  switch (kind) {
    case 'candidateUrl':
      return usage.candidateUrls;
    case 'fetch':
      return usage.fetches;
    case 'extraction':
      return usage.extractions;
    case 'nativeFetch':
      return usage.nativeFetches;
    case 'externalFetch':
      return usage.externalFetches;
    case 'aiCall':
      return usage.aiCalls;
    case 'elapsed':
      return 0; // tempo é medido por relógio, não por contador
  }
}

/**
 * Há orçamento restante para `kind`? Para 'elapsed', compara o relógio contra
 * maxElapsedMs. Para os demais, compara contador de uso contra o limite.
 */
export function hasBudgetRemaining(
  ctx: BudgetBearer,
  kind: BudgetKind,
): boolean {
  if (kind === 'elapsed') {
    return Date.now() - ctx.startedAt < ctx.budget.maxElapsedMs;
  }
  return usageFor(ctx.budgetUsage, kind) < limitFor(ctx.budget, kind);
}

/**
 * Consome uma unidade de `kind`. Retorna false (e NÃO incrementa) se não há
 * orçamento. 'elapsed' não é consumível (sempre retorna hasBudgetRemaining).
 */
export function consumeBudget(ctx: BudgetBearer, kind: BudgetKind): boolean {
  if (kind === 'elapsed') {
    return hasBudgetRemaining(ctx, kind);
  }
  if (!hasBudgetRemaining(ctx, kind)) return false;
  switch (kind) {
    case 'candidateUrl':
      ctx.budgetUsage.candidateUrls += 1;
      break;
    case 'fetch':
      ctx.budgetUsage.fetches += 1;
      break;
    case 'extraction':
      ctx.budgetUsage.extractions += 1;
      break;
    case 'nativeFetch':
      ctx.budgetUsage.nativeFetches += 1;
      break;
    case 'externalFetch':
      ctx.budgetUsage.externalFetches += 1;
      break;
    case 'aiCall':
      ctx.budgetUsage.aiCalls += 1;
      break;
  }
  return true;
}

/**
 * SearchEngineContext — estado de uma execução do motor próprio (Etapa 5).
 *
 * Carrega tudo que o pipeline precisa para buscar um produto em UM fornecedor:
 * supplier, recipe opcional, query (crua + normalizada), instante de início,
 * orçamento + uso, política de providers e o diagnostics em memória.
 *
 * `createSearchEngineContext` aplica os defaults seguros (motor próprio ligado,
 * Firecrawl/IA desligados, externo/IA com orçamento zero). O contexto satisfaz
 * estruturalmente o `BudgetBearer`, então os helpers de orçamento operam
 * diretamente sobre ele.
 *
 * Funções PURAS exceto `addDiagnosticAttempt`, que muta o array de diagnostics.
 */
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';
import {
  createBudgetUsage,
  resolveBudget,
  type BudgetUsage,
  type SearchBudget,
} from './searchBudget.js';
import {
  resolveProviderPolicy,
  type ProviderPolicy,
} from '../providers/providerPolicy.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';

export interface SearchDiagnostics {
  attempts: SearchAttempt[];
}

export interface SearchEngineContext {
  searchId?: string;
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
  normalizedQuery: string;
  /** Date.now() do início — base para o orçamento de tempo. */
  startedAt: number;
  budget: SearchBudget;
  budgetUsage: BudgetUsage;
  providerPolicy: ProviderPolicy;
  diagnostics: SearchDiagnostics;
}

/**
 * Normaliza a query para uso no motor: minúsculas, sem acentos, sem
 * pontuação, espaços colapsados. Mesma família de normalização usada no
 * matching/cacheKey, mas isolada aqui para o motor não depender deles.
 */
export function normalizeSearchQuery(query: string): string {
  return (query ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CreateSearchEngineContextInput {
  supplier: Supplier;
  query: string;
  searchId?: string;
  recipe?: SupplierRecipe | null;
  budget?: Partial<SearchBudget>;
  providerPolicy?: Partial<ProviderPolicy>;
  /** Override do instante de início (testes). Default Date.now(). */
  startedAt?: number;
}

/**
 * Cria um SearchEngineContext com os defaults seguros aplicados.
 */
export function createSearchEngineContext(
  input: CreateSearchEngineContextInput,
): SearchEngineContext {
  return {
    searchId: input.searchId,
    supplier: input.supplier,
    recipe: input.recipe ?? null,
    query: input.query,
    normalizedQuery: normalizeSearchQuery(input.query),
    startedAt: input.startedAt ?? Date.now(),
    budget: resolveBudget(input.budget),
    budgetUsage: createBudgetUsage(),
    providerPolicy: resolveProviderPolicy(input.providerPolicy),
    diagnostics: { attempts: [] },
  };
}

/**
 * Registra um SearchAttempt no diagnostics do contexto (mutação controlada).
 * Devolve o próprio attempt para encadeamento.
 */
export function addDiagnosticAttempt(
  context: SearchEngineContext,
  attempt: SearchAttempt,
): SearchAttempt {
  context.diagnostics.attempts.push(attempt);
  return attempt;
}

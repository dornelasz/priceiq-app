/**
 * pipelineTypes — contratos do pipeline próprio executável (Etapa 7).
 *
 * Reúne entrada/saída de `runOwnSearchPipeline`. Sem comportamento.
 */
import type { SupplierRecipe, UniversalSearchResult } from '../../types.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type { SearchEngineContext } from '../core/searchEngineContext.js';
import type { SearchBudget } from '../core/searchBudget.js';
import type { ProviderPolicy } from '../providers/providerPolicy.js';
import type { FetchProvider } from '../providers/fetchProvider.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';

export interface RunOwnSearchPipelineInput {
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
  searchId?: string;
  providerPolicy?: Partial<ProviderPolicy>;
  budget?: Partial<SearchBudget>;
  /**
   * FetchProvider único injetável (compat Etapa 7 / testes).
   * Default: createNativeFetchProvider(). Ignorado se `fetchProviders` vier.
   */
  fetchProvider?: FetchProvider;
  /**
   * Cadeia ordenada de providers (Etapa 11). Quando presente, o pipeline tenta
   * cada um em ordem com fallback. Ex: [firecrawl, native].
   */
  fetchProviders?: FetchProvider[];
  /** Limite de candidatos a descobrir (default = budget.maxCandidateUrls). */
  maxCandidates?: number;
  /** Timeout por fetch em ms (repassado ao provider). */
  timeoutMs?: number;
  /** Match score mínimo para validar (repassado ao extractor). */
  minMatchScore?: number;
}

export interface OwnSearchPipelineOutcome {
  /** Resultado universal terminal (validated/partial via freightStatus, ou falha controlada). */
  result: UniversalSearchResult;
  /** Contexto completo com orçamento usado e diagnostics. */
  context: SearchEngineContext;
  /** URLs candidatas efetivamente testadas, em ordem. */
  candidateUrls: string[];
  /** Cópia do diagnostics em memória da execução. */
  attempts: SearchAttempt[];
  elapsedMs: number;
  /** Ordem dos providers de coleta usada nesta execução (ex: ['firecrawl','native']). */
  providerPriority?: string[];
  /** Firecrawl estava ligado nesta execução? */
  firecrawlEnabled?: boolean;
  /** Algum passo precisou cair para um provider de fallback? */
  usedFallback?: boolean;
}

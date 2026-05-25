/**
 * catalogDiscoveryTypes — contratos do discovery avançado de catálogo (Etapa 15).
 *
 * Define as fontes de descoberta (Firecrawl Search/Map, Sitemap, Search Page),
 * o input/output do orquestrador e os tipos intermediários compartilhados pelas
 * funções de cada fonte. Apenas TIPOS — sem comportamento.
 */
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { ProviderPolicy } from '../providers/providerPolicy.js';
import type { SearchBudget } from '../core/searchBudget.js';
import type {
  SupplierDiscoverySource,
  SupplierDiscoveryRunStatus,
} from '../../catalog/index.js';

/** Fontes de descoberta que populam o catálogo. */
export type CatalogDiscoverySource = SupplierDiscoverySource;

/** URL descoberta por uma fonte, antes de ranking/persistência. */
export interface DiscoveredUrl {
  url: string;
  title?: string;
}

/**
 * Status do fetch de UMA fonte (antes de saber quantos candidatos foram salvos).
 * Espelha os estados controlados do FetchProvider/Firecrawl.
 */
export type SourceFetchStatus =
  | 'success' // a fonte respondeu (pode ter 0 URLs)
  | 'blocked'
  | 'rate_limited'
  | 'no_credits'
  | 'timeout'
  | 'error'
  | 'disabled'; // fonte indisponível/desligada — não foi tentada

/** Resultado bruto de uma fonte de descoberta (sem persistência ainda). */
export interface SourceDiscoveryResult {
  source: CatalogDiscoverySource;
  fetchStatus: SourceFetchStatus;
  urls: DiscoveredUrl[];
  attempts: SearchAttempt[];
  errorMessage?: string;
}

/** Status final reportado por fonte no resultado do orquestrador. */
export type SourceOutcomeStatus = SupplierDiscoveryRunStatus | 'skipped';

/** Resumo por fonte após persistência. */
export interface SourceOutcome {
  source: CatalogDiscoverySource;
  /** id do discovery_run criado (null se a fonte foi pulada). */
  runId: string | null;
  status: SourceOutcomeStatus;
  fetchStatus: SourceFetchStatus;
  candidatesFound: number;
  candidatesSaved: number;
  candidatesRejected: number;
  errorMessage?: string;
}

export interface CatalogDiscoveryInput {
  supplier: Supplier;
  query: string;
  recipe?: SupplierRecipe | null;
  /** Teto de candidatos persistidos por fonte. Default 20. */
  maxCandidates?: number;
  /** Fontes habilitadas. Default: todas. */
  sources?: CatalogDiscoverySource[];
  providerPolicy?: Partial<ProviderPolicy>;
  budget?: Partial<SearchBudget>;
}

export interface CatalogDiscoveryResult {
  supplierId: string;
  query: string;
  normalizedQuery: string;
  /** Matches confirmados já existentes para esta query (reaproveitáveis). */
  reusableMatches: number;
  candidatesFound: number;
  candidatesSaved: number;
  candidatesRejected: number;
  sourceBreakdown: SourceOutcome[];
  discoveryRunIds: string[];
  attempts: SearchAttempt[];
  errors: Array<{ source: string; message: string }>;
}

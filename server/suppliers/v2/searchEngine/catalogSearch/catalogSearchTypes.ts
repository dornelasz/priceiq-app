/**
 * catalogSearchTypes — contratos do fluxo catalog-first (Etapa 17).
 *
 * Define input/output de runCatalogFirstSupplierSearch e os tipos
 * auxiliares UsefulResult e FailedResult. Apenas TIPOS — sem comportamento.
 */
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { ProviderPolicy } from '../providers/providerPolicy.js';
import type { SearchBudget } from '../core/searchBudget.js';
import type { SupplierProductMatchStatus } from '../../catalog/index.js';
import type { CandidateProcessingStatus } from '../catalogProcessing/catalogProcessingTypes.js';

/** Status global do fluxo catalog-first. */
export type CatalogSearchStatus =
  | 'completed'     // ≥1 usefulResult, sem erros
  | 'partial'       // ≥1 usefulResult mas com erros
  | 'no_candidates' // discovery encontrou 0 candidatos
  | 'no_matches'    // processamento rodou mas gerou 0 usefulResults
  | 'failed';       // erro técnico que abortou o fluxo

/** Como chegamos aos results — reuso ou discovery completo. */
export type CatalogSearchStrategy =
  | 'reused_matches'
  | 'discovered_then_processed';

export interface CatalogSearchInput {
  supplier: Supplier;
  query: string;
  recipe?: SupplierRecipe | null;
  /** Teto de matches reutilizáveis buscados. Default 5. */
  maxReusableMatches?: number;
  /** Teto de candidatos salvos pelo discovery. Default 20. */
  maxDiscoveryCandidates?: number;
  /** Teto de candidatos processados pelo processor. Default 5. */
  maxProcessingCandidates?: number;
  /** Score mínimo para considerar match. Default config.MIN_MATCH_SCORE. */
  minMatchScore?: number;
  providerPolicy?: Partial<ProviderPolicy>;
  budget?: Partial<SearchBudget>;
  timeoutMs?: number;
}

/**
 * Candidato com extração útil: validated ou partial com evidência + preço.
 * Frete desconhecido → freight=null, NUNCA 0.
 */
export interface UsefulResult {
  candidateId: string;
  productUrl: string;
  productName: string | null;
  price: number | null;
  currency: string | null;
  priceBrl: number | null;
  freight: number | null;
  freightStatus: string | null;
  totalBrl: number | null;
  matchScore: number | null;
  confidence: number | null;
  evidenceText: string | null;
  status: 'validated' | 'partial';
  matchStatus: SupplierProductMatchStatus | null;
}

/** Candidato que não gerou resultado útil. */
export interface FailedResult {
  candidateId: string;
  productUrl: string;
  status: CandidateProcessingStatus;
  reason?: string | null;
}

export interface CatalogSearchDiagnostics {
  reusableMatchesFound: number;
  /** Candidatos salvos por fonte de discovery (vazio no path reused_matches). */
  candidatesDiscoveredBySource: Record<string, number>;
  processingStatusBreakdown: Record<string, number>;
  attemptCount: number;
}

export interface CatalogSearchResult {
  supplierId: string;
  query: string;
  normalizedQuery: string;
  status: CatalogSearchStatus;
  strategy: CatalogSearchStrategy | null;
  reusedMatchesCount: number;
  candidatesDiscovered: number;
  candidatesProcessed: number;
  matchesCreated: number;
  usefulResults: UsefulResult[];
  failures: FailedResult[];
  attempts: SearchAttempt[];
  diagnostics: CatalogSearchDiagnostics;
  recommendation?: string;
  errors: Array<{ message: string }>;
}

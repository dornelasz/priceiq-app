/**
 * catalogProcessingTypes — contratos do processador de candidatos do catálogo
 * (Etapa 16).
 *
 * O processamento pega candidatos já salvos (Etapa 14/15), raspa a product_url,
 * extrai com o localProductExtractor (Etapa 4), valida o match e grava
 * supplier_product_matches. Apenas TIPOS aqui — sem comportamento.
 */
import type { Supplier } from '../../../../services/supplierService.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';
import type { ProviderPolicy } from '../providers/providerPolicy.js';
import type { SearchBudget } from '../core/searchBudget.js';
import type {
  SupplierProductCandidateStatus,
  SupplierProductMatchStatus,
} from '../../catalog/index.js';

export interface CatalogProcessingInput {
  supplier: Supplier;
  query: string;
  /** Processar apenas estes candidatos (por id). Default: todos da query. */
  candidateIds?: string[];
  /** Teto de candidatos processados. Default 5. */
  maxCandidates?: number;
  /** Score mínimo para considerar match (default config.MIN_MATCH_SCORE). */
  minMatchScore?: number;
  providerPolicy?: Partial<ProviderPolicy>;
  budget?: Partial<SearchBudget>;
  timeoutMs?: number;
}

/** Status do processamento de UM candidato (resultado da raspagem+extração). */
export type CandidateProcessingStatus =
  | 'validated'
  | 'partial'
  | 'product_mismatch'
  | 'price_not_found'
  | 'invalid_link'
  | 'not_found'
  | 'blocked'
  | 'timeout'
  | 'error';

export interface ProcessedCandidate {
  candidateId: string;
  productUrl: string;
  status: CandidateProcessingStatus;
  /** Status persistido no candidato (pode diferir do de processamento). */
  candidateStatus: SupplierProductCandidateStatus | null;
  matchScore: number | null;
  matchStatus: SupplierProductMatchStatus | null;
  updated: boolean;
  matchCreated: boolean;
}

export type CatalogProcessingStatus =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'no_candidates';

export interface CatalogProcessingResult {
  supplierId: string;
  query: string;
  normalizedQuery: string;
  status: CatalogProcessingStatus;
  candidatesProcessed: number;
  candidatesUpdated: number;
  matchesCreated: number;
  matchesRejected: number;
  statusBreakdown: Record<string, number>;
  processed: ProcessedCandidate[];
  attempts: SearchAttempt[];
  errors: Array<{ candidateId?: string; message: string }>;
  recommendation?: string;
}

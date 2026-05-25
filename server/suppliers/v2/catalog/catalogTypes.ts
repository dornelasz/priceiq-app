/**
 * catalogTypes — contratos do Supplier Product Catalog (Etapa 14).
 *
 * Define os tipos de dados para as três tabelas do catálogo:
 *   - supplier_product_candidates
 *   - supplier_product_matches
 *   - supplier_discovery_runs
 */

// ─── Enums como literal unions ────────────────────────────────────────────────

export type SupplierProductCandidateStatus =
  | 'candidate'
  | 'extracted'
  | 'matched'
  | 'rejected'
  | 'blocked'
  | 'price_not_found'
  | 'product_mismatch'
  | 'validated'
  | 'partial';

export type SupplierProductSource =
  | 'search_page'
  | 'firecrawl_search'
  | 'firecrawl_map'
  | 'sitemap'
  | 'manual_seed'
  | 'cached_match';

export type SupplierProductMatchStatus = 'confirmed' | 'pending' | 'rejected';

export type SupplierDiscoveryRunStatus =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'no_candidates';

export type SupplierDiscoverySource =
  | 'search_page'
  | 'firecrawl_search'
  | 'firecrawl_map'
  | 'sitemap';

// ─── Entidades (mapeiam 1:1 com as linhas do banco) ──────────────────────────

export interface SupplierProductCandidate {
  id: string;
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  productUrl: string;
  canonicalUrl: string | null;
  urlHash: string;
  source: SupplierProductSource;
  status: SupplierProductCandidateStatus;
  productName: string | null;
  brand: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  priceBrl: number | null;
  freight: number | null;
  freightStatus: string | null;
  totalBrl: number | null;
  matchScore: number | null;
  confidence: number | null;
  evidenceText: string | null;
  priceEvidenceText: string | null;
  lastCheckedAt: string | null;
  firstSeenAt: string;
  updatedAt: string;
}

export interface SupplierProductMatch {
  id: string;
  supplierId: string;
  candidateId: string;
  queryText: string;
  normalizedQuery: string;
  matchStatus: SupplierProductMatchStatus;
  matchScore: number | null;
  confidence: number | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDiscoveryRun {
  id: string;
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  source: SupplierDiscoverySource;
  status: SupplierDiscoveryRunStatus;
  candidatesFound: number;
  candidatesSaved: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// ─── Inputs das operações do serviço ─────────────────────────────────────────

export interface UpsertCandidateInput {
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  productUrl: string;
  canonicalUrl?: string | null;
  urlHash: string;
  source: SupplierProductSource;
  status?: SupplierProductCandidateStatus;
  matchScore?: number | null;
}

export interface UpdateCandidateExtractionInput {
  candidateId: string;
  status: SupplierProductCandidateStatus;
  productName?: string | null;
  brand?: string | null;
  sku?: string | null;
  price?: number | null;
  currency?: string | null;
  priceBrl?: number | null;
  freight?: number | null;
  freightStatus?: string | null;
  totalBrl?: number | null;
  /** Score de match da extração. null preserva o valor atual (COALESCE). */
  matchScore?: number | null;
  confidence?: number | null;
  evidenceText?: string | null;
  priceEvidenceText?: string | null;
}

export interface CreateDiscoveryRunInput {
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  source: SupplierDiscoverySource;
}

export interface FinishDiscoveryRunInput {
  runId: string;
  status: SupplierDiscoveryRunStatus;
  candidatesFound: number;
  candidatesSaved: number;
  errorMessage?: string | null;
}

export interface CreateOrUpdateMatchInput {
  supplierId: string;
  candidateId: string;
  queryText: string;
  normalizedQuery: string;
  matchStatus: SupplierProductMatchStatus;
  matchScore?: number | null;
  confidence?: number | null;
  reason?: string | null;
}

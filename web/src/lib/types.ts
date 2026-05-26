// Tipos compartilhados com o backend.
// Sempre que o backend mudar, atualize aqui também (Etapa 5 vai gerar isso
// automaticamente a partir do schema Zod).

export type Currency = 'BRL' | 'USD' | 'EUR' | 'CNY';
export type SupplierType = 'Nacional' | 'Internacional';
export type ExtractionMode = 'jina_reader' | 'playwright' | 'direct_api';
export type SearchStatus = 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed';

// ─── V2 — Status do fornecedor e receita (Fase B do Universal Adapter V2) ──
//
// Estes tipos refletem os contratos definidos em server/suppliers/v2/types.ts.
// São opcionais no `Supplier` enquanto a UI ainda não consome os campos —
// a tela de fornecedores será atualizada em fase posterior.

export type SupplierCertificationStatus =
  | 'unconfigured'
  | 'auto_configuring'
  | 'certified'
  | 'needs_guided_setup'
  | 'blocked'
  | 'requires_login'
  | 'unsupported'
  | 'failed';

export type ExtractionStrategy =
  | 'json_ld'
  | 'schema_org'
  | 'meta_tags'
  | 'script_json'
  | 'next_data'
  | 'dom'
  | 'visual_heuristic'
  | 'jina_fallback'
  | 'playwright_fallback'
  | 'guided_selector'
  | 'specialized_adapter';

export interface SupplierRecipe {
  id?: string;
  supplierId: string;
  status: SupplierCertificationStatus;
  platformDetected?: string | null;
  searchUrlTemplate?: string | null;
  productUrlPatterns?: string[];
  extractionStrategy?: ExtractionStrategy | null;
  titleSelector?: string | null;
  priceSelector?: string | null;
  currencySelector?: string | null;
  imageSelector?: string | null;
  availabilitySelector?: string | null;
  jsonLdEnabled?: boolean;
  jsonPaths?: Record<string, unknown> | null;
  requiresJs?: boolean;
  requiresBrowser?: boolean;
  confidence?: number | null;
  lastTestedAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  configJson?: Record<string, unknown> | null;
}

export interface Supplier {
  id: string;
  name: string;
  site: string;
  search_url_template: string;
  country: string;
  currency: Currency;
  type: SupplierType;
  active: boolean;
  extraction_mode: ExtractionMode;
  extractor_config: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // ─── V2 — Fase B (opcionais para compat com clientes antigos) ──────────
  certificationStatus?: SupplierCertificationStatus;
  setupStatus?: SupplierCertificationStatus;
  autoConfiguredAt?: string | null;
  recipe?: SupplierRecipe | null;
}

export interface SupplierInput {
  name: string;
  site: string;
  search_url_template: string;
  country?: string;
  currency?: Currency;
  type?: SupplierType;
  active?: boolean;
  extraction_mode?: ExtractionMode;
  extractor_config?: Record<string, unknown>;
  notes?: string | null;
}

export interface Search {
  id: string;
  query: string;
  status: SearchStatus;
  selected_supplier_ids: string[];
  best_supplier: string | null;
  best_total_brl: number | null;
  created_at: string;
  completed_at: string | null;
}

export type LinkType = 'product' | 'search' | 'unverified';

export type ResultStatus =
  | 'validated'
  | 'cached'
  | 'partial'
  | 'not_found'
  | 'blocked'
  | 'invalid_link'
  | 'price_not_found'
  | 'product_mismatch'
  | 'timeout'
  | 'error';

export interface SearchResult {
  id: string;
  search_id: string;
  supplier_id: string;
  supplier_name: string;
  product_name: string | null;
  seller_name: string | null;
  price: number | null;
  freight: number | null;
  total_price: number | null;
  currency: string | null;
  exchange_rate_used: number | null;
  total_brl: number | null;
  price_brl: number | null;
  product_url: string | null;
  match_score: number | null;
  confidence: number | null;
  available: boolean | null;
  warning: string | null;
  error_message: string | null;
  from_cache: boolean;
  collected_at: string;
  // Etapa 5.1 — validação anti produto fantasma
  link_type: LinkType | null;
  link_validated: boolean;
  evidence_text: string | null;
  source_url: string | null;
  source_name: string | null;
  validation_warning: string | null;
  // Etapa 2 — contrato único de status por resultado
  status: ResultStatus;
}

// ─── Catálogo de produtos por fornecedor (Etapa 19A — leitura) ───────────────

export type CandidateStatus =
  | 'candidate' | 'extracted' | 'matched' | 'rejected' | 'blocked'
  | 'price_not_found' | 'product_mismatch' | 'validated' | 'partial';

export type SupplierProductSource =
  | 'search_page' | 'firecrawl_search' | 'firecrawl_map'
  | 'sitemap' | 'manual_seed' | 'cached_match';

export type MatchStatus = 'confirmed' | 'pending' | 'rejected';

export type DiscoveryRunStatus =
  | 'completed' | 'partial' | 'failed' | 'blocked' | 'no_candidates';

export interface CatalogCandidate {
  id: string;
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  productUrl: string;
  canonicalUrl: string | null;
  urlHash: string;
  source: SupplierProductSource;
  status: CandidateStatus;
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
  firstSeenAt: string;
  updatedAt: string;
}

export interface CatalogMatch {
  id: string;
  supplierId: string;
  candidateId: string;
  queryText: string;
  normalizedQuery: string;
  matchStatus: MatchStatus;
  matchScore: number | null;
  confidence: number | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogDiscoveryRun {
  id: string;
  supplierId: string;
  queryText: string;
  normalizedQuery: string;
  source: SupplierProductSource;
  status: DiscoveryRunStatus;
  candidatesFound: number;
  candidatesSaved: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CatalogCandidatesResponse {
  ok: boolean;
  supplierId: string;
  query: string;
  normalizedQuery: string;
  count: number;
  candidates: CatalogCandidate[];
}

export interface CatalogMatchesResponse {
  ok: boolean;
  supplierId: string;
  query: string;
  normalizedQuery: string;
  count: number;
  matches: CatalogMatch[];
}

export interface CatalogDiscoveryRunsResponse {
  ok: boolean;
  supplierId: string;
  query: string;
  normalizedQuery: string;
  count: number;
  runs: CatalogDiscoveryRun[];
}

export interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
  partial?: boolean;
  warnings?: { usd: string | null; eur: string | null; cny: string | null };
}

export interface ApiError {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

// Resposta de GET /api/searches/:id/results
export interface SearchProgress {
  total: number;
  completed: number;
  failed: number;
  partial: number;
  running: number;
}

export interface SearchErrorEntry {
  supplier_id: string;
  supplier_name: string;
  status: ResultStatus;
  error_message: string | null;
}

export interface SearchResultsResponse {
  search: Search;
  progress: SearchProgress;
  results: SearchResult[];
  partials: SearchResult[];
  errors: SearchErrorEntry[];
  best: SearchResult | null;
}

// Resposta de POST /api/searches
export interface SearchCreatedResponse {
  searchId: string;
  status: SearchStatus;
}

// Resposta de GET /api/health
export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  timestamp: string;
  version: string;
}

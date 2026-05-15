// Tipos compartilhados com o backend.
// Sempre que o backend mudar, atualize aqui também (Etapa 5 vai gerar isso
// automaticamente a partir do schema Zod).

export type Currency = 'BRL' | 'USD' | 'EUR' | 'CNY';
export type SupplierType = 'Nacional' | 'Internacional';
export type ExtractionMode = 'jina_reader' | 'playwright' | 'direct_api';
export type SearchStatus = 'pending' | 'running' | 'completed' | 'failed';

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

export interface SearchResult {
  id: string;
  search_id: string;
  supplier_id: string;
  product_name: string | null;
  seller_name: string | null;
  price: number | null;
  freight: number | null;
  total_price: number | null;
  currency: string | null;
  exchange_rate_used: number | null;
  total_brl: number | null;
  product_url: string | null;
  match_score: number | null;
  confidence: number | null;
  available: boolean | null;
  warning: string | null;
  error_message: string | null;
  from_cache: boolean;
  collected_at: string;
}

export interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
  partial?: boolean;
}

export interface ApiError {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

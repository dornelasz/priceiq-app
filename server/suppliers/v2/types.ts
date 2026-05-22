/**
 * Contratos do Universal Supplier Adapter V2.
 *
 * Esta camada é APENAS estrutural — define os tipos, status e contratos que
 * serão usados pelas próximas fases do novo motor de busca. Não substitui
 * nada da busca atual. Importar destes arquivos é seguro.
 *
 * Princípios:
 *  - Frete desconhecido NUNCA vira 0. Veja FreightStatus.
 *  - Um resultado pode ser 'validated' (produto + preço com evidência) mesmo
 *    sem frete confirmado. O total final só é confirmável quando o frete for
 *    'confirmed' ou 'free_confirmed'.
 *  - Toda extração validada precisa de evidência textual (sourceUrl + trecho).
 */

// ─── Status de certificação do fornecedor ───────────────────────────────
//
// Cada fornecedor cadastrado tem exatamente UM destes status.
// O fluxo padrão é:
//   unconfigured → auto_configuring → certified
//                                  ↘ needs_guided_setup → certified
//                                  ↘ blocked | requires_login | unsupported | failed

export const SUPPLIER_CERTIFICATION_STATUSES = [
  'unconfigured',
  'auto_configuring',
  'certified',
  'needs_guided_setup',
  'blocked',
  'requires_login',
  'unsupported',
  'failed',
] as const;

export type SupplierCertificationStatus =
  (typeof SUPPLIER_CERTIFICATION_STATUSES)[number];

// ─── Status de resultado de busca V2 ────────────────────────────────────
//
// Equivale ao ResultStatus atual + 'needs_supplier_setup' (quando o
// fornecedor não tem receita certificada e ainda não pode ser buscado).

export const SEARCH_RESULT_STATUSES_V2 = [
  'validated',
  'cached',
  'not_found',
  'blocked',
  'invalid_link',
  'price_not_found',
  'product_mismatch',
  'timeout',
  'error',
  'needs_supplier_setup',
] as const;

export type SearchResultStatusV2 = (typeof SEARCH_RESULT_STATUSES_V2)[number];

// ─── Status de frete (3+1 estados) ──────────────────────────────────────
//
//   not_available   — não há informação. freight DEVE ser null.
//   free_confirmed  — texto explícito "frete grátis" / "free shipping".
//                     freight DEVE ser 0.
//   confirmed       — valor numérico explícito encontrado na página.
//                     freight DEVE ser > 0.
//   estimated       — valor inferido (CEP genérico, faixa, etc). NÃO conta
//                     como total final confirmado.

export const FREIGHT_STATUSES = [
  'not_available',
  'free_confirmed',
  'confirmed',
  'estimated',
] as const;

export type FreightStatus = (typeof FREIGHT_STATUSES)[number];

// ─── Tipo do link extraído ──────────────────────────────────────────────
//
//   product  — URL aponta para a página de produto específica (canônico).
//   search   — URL é uma SERP do fornecedor (lista, não produto).
//   category — URL é uma página de categoria.
//   unknown  — não foi possível classificar.

export const LINK_TYPES = ['product', 'search', 'category', 'unknown'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

// ─── Estratégia de extração utilizada ───────────────────────────────────
//
// Ordem natural de preferência (mais confiável → menos):
//   json_ld → schema_org → meta_tags → script_json → next_data → dom
//   → visual_heuristic → jina_fallback / playwright_fallback
//   guided_selector e specialized_adapter são receitas dedicadas.

export const EXTRACTION_STRATEGIES = [
  'json_ld',
  'schema_org',
  'meta_tags',
  'script_json',
  'next_data',
  'dom',
  'visual_heuristic',
  'jina_fallback',
  'playwright_fallback',
  'guided_selector',
  'specialized_adapter',
] as const;

export type ExtractionStrategy = (typeof EXTRACTION_STRATEGIES)[number];

// ─── Evidência da extração ──────────────────────────────────────────────

export interface SearchEvidence {
  sourceUrl: string;
  sourceName?: string;
  evidenceText: string;
  extractedAt: string;
  strategy: ExtractionStrategy;
}

// ─── Resultado universal de busca ───────────────────────────────────────

export interface UniversalSearchResult {
  found: boolean;
  status: SearchResultStatusV2;
  productName?: string;
  normalizedProductName?: string;
  price?: number | null;
  currency?: string | null;
  freight?: number | null;
  freightStatus: FreightStatus;
  totalPrice?: number | null;
  productUrl?: string | null;
  linkType: LinkType;
  linkValidated: boolean;
  matchScore?: number | null;
  confidence?: number | null;
  available?: boolean | null;
  warning?: string | null;
  errorMessage?: string | null;
  evidence?: SearchEvidence | null;
}

// ─── Receita persistida por fornecedor ──────────────────────────────────
//
// Esta é a representação em runtime. O esquema do banco será criado em uma
// fase posterior; aqui só definimos a forma usada por código.

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

// ─── Resultado de auto-configuração ─────────────────────────────────────

export interface SupplierAutoConfigResult {
  supplierId: string;
  status: SupplierCertificationStatus;
  platformDetected?: string | null;
  searchUrlTemplate?: string | null;
  confidence?: number | null;
  error?: string | null;
  recipe?: SupplierRecipe | null;
}

import { z } from 'zod';
import { isValidSearchUrlTemplate, isValidSiteOrUrl } from './searchUrlBuilder.js';

// ─── Suppliers ───────────────────────────────────────────

export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  site: z.string().min(3).max(200).refine(
    (s) => isValidSiteOrUrl(s),
    { message: 'site precisa ser um domínio ou URL válido (ex: amazon.com.br)' },
  ),
  // Template é opcional. Quando preenchido, precisa ser URL http(s) válida.
  // Placeholders aceitos: {q}, {query}, {produto}. Sem placeholder a UI avisa
  // que a busca pode não funcionar corretamente. Sem template usamos fallback.
  search_url_template: z.string().max(500).default('').refine(
    (s) => s === '' || isValidSearchUrlTemplate(s),
    { message: 'search_url_template precisa ser URL http(s) válida' },
  ),
  country: z.string().min(2).max(80).default('Brasil'),
  currency: z.enum(['BRL', 'USD', 'EUR', 'CNY']).default('BRL'),
  type: z.enum(['Nacional', 'Internacional']).default('Nacional'),
  active: z.boolean().default(true),
  extraction_mode: z.enum(['jina_reader', 'playwright', 'direct_api']).default('jina_reader'),
  extractor_config: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(500).optional().nullable(),
});
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = supplierCreateSchema.partial();
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const idParamSchema = z.object({
  id: z.string().uuid('id inválido'),
});

// Rota de diagnóstico do motor próprio (Etapa 8). Apenas a query é exigida.
export const ownSearchTestSchema = z.object({
  query: z.string().min(1, 'query é obrigatória').max(300),
});
export type OwnSearchTestInput = z.infer<typeof ownSearchTestSchema>;

// Rota de discovery de catálogo (Etapa 15). Roda as fontes de descoberta para
// popular o Supplier Product Catalog. Não extrai preço nem usa IA.
export const discoverCatalogSchema = z.object({
  query: z.string().min(1, 'query é obrigatória').max(300),
  sources: z
    .array(z.enum(['firecrawl_search', 'firecrawl_map', 'sitemap', 'search_page']))
    .min(1)
    .optional(),
  maxCandidates: z.coerce.number().int().min(1).max(100).optional(),
});
export type DiscoverCatalogInput = z.infer<typeof discoverCatalogSchema>;

// Rota de processamento de catálogo (Etapa 16). Raspa candidatos já salvos e
// cria matches. Não extrai cotação nem usa IA.
export const processCatalogSchema = z.object({
  query: z.string().min(1, 'query é obrigatória').max(300),
  maxCandidates: z.coerce.number().int().min(1).max(50).optional(),
  minMatchScore: z.coerce.number().int().min(0).max(100).optional(),
  candidateIds: z.array(z.string().uuid()).optional(),
});
export type ProcessCatalogInput = z.infer<typeof processCatalogSchema>;

// Rota catalog-first (Etapa 17). Orquestra discovery + processing em um único
// passo, reutilizando matches já confirmados quando disponíveis.
export const catalogSearchSchema = z.object({
  query: z.string().min(1, 'query é obrigatória').max(300),
  maxReusableMatches: z.coerce.number().int().min(1).max(50).optional(),
  maxDiscoveryCandidates: z.coerce.number().int().min(1).max(100).optional(),
  maxProcessingCandidates: z.coerce.number().int().min(1).max(50).optional(),
  minMatchScore: z.coerce.number().int().min(0).max(100).optional(),
});
export type CatalogSearchSchemaInput = z.infer<typeof catalogSearchSchema>;

// ─── Searches ────────────────────────────────────────────

export const searchCreateSchema = z.object({
  query: z.string().min(1).max(300),
  // Aceita ambos: supplierIds (Etapa 5 spec) E supplier_ids (compat anterior)
  supplierIds: z.array(z.string().uuid()).optional(),
  supplier_ids: z.array(z.string().uuid()).optional(),
  forceRefresh: z.boolean().optional().default(false),
});
export type SearchCreateInput = z.infer<typeof searchCreateSchema>;

export const searchListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchListQuery = z.infer<typeof searchListQuerySchema>;

// ─── Rates ───────────────────────────────────────────────

export const rateResponseSchema = z.object({
  usd: z.number().positive().nullable(),
  eur: z.number().positive().nullable(),
  cny: z.number().positive().nullable(),
  source: z.string(),
  fetched_at: z.string(),
  from_cache: z.boolean(),
});
export type RateResponse = z.infer<typeof rateResponseSchema>;

import { z } from 'zod';

// ─── Suppliers ───────────────────────────────────────────

export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  site: z.string().min(3).max(200),
  search_url_template: z.string().min(3).max(500).refine(
    (s) => s.includes('{q}'),
    { message: 'search_url_template precisa conter {q}' },
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

// ─── Searches ────────────────────────────────────────────

export const searchCreateSchema = z.object({
  query: z.string().min(1).max(300),
  supplier_ids: z.array(z.string().uuid()).optional(),
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

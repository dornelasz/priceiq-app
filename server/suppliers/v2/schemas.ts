/**
 * Schemas Zod dos contratos V2.
 *
 * Cada schema corresponde a um tipo em ./types.ts. As listas de status são
 * importadas de lá para garantir uma única fonte de verdade.
 *
 * Regras estruturais de frete são reforçadas via superRefine:
 *  - not_available  → freight DEVE ser null/undefined
 *  - free_confirmed → freight DEVE ser 0
 *  - confirmed      → freight DEVE ser > 0
 *  - estimated      → freight pode ser número finito ≥ 0 (estimativa)
 */
import { z } from 'zod';
import {
  EXTRACTION_STRATEGIES,
  FREIGHT_STATUSES,
  LINK_TYPES,
  SEARCH_RESULT_STATUSES_V2,
  SUPPLIER_CERTIFICATION_STATUSES,
} from './types.js';

// ─── Enums Zod ──────────────────────────────────────────────────────────

export const supplierCertificationStatusSchema = z.enum(
  SUPPLIER_CERTIFICATION_STATUSES,
);

export const searchResultStatusV2Schema = z.enum(SEARCH_RESULT_STATUSES_V2);

export const freightStatusSchema = z.enum(FREIGHT_STATUSES);

export const linkTypeSchema = z.enum(LINK_TYPES);

export const extractionStrategySchema = z.enum(EXTRACTION_STRATEGIES);

// ─── SearchEvidence ─────────────────────────────────────────────────────

export const searchEvidenceSchema = z.object({
  sourceUrl: z.string().min(1),
  sourceName: z.string().min(1).optional(),
  evidenceText: z.string().min(1),
  extractedAt: z.string().min(1),
  strategy: extractionStrategySchema,
});

// ─── UniversalSearchResult ──────────────────────────────────────────────

export const universalSearchResultSchema = z
  .object({
    found: z.boolean(),
    status: searchResultStatusV2Schema,
    productName: z.string().optional(),
    normalizedProductName: z.string().optional(),
    price: z.number().finite().nullable().optional(),
    currency: z.string().min(1).nullable().optional(),
    freight: z.number().finite().nullable().optional(),
    freightStatus: freightStatusSchema,
    totalPrice: z.number().finite().nullable().optional(),
    productUrl: z.string().min(1).nullable().optional(),
    linkType: linkTypeSchema,
    linkValidated: z.boolean(),
    matchScore: z.number().finite().nullable().optional(),
    confidence: z.number().finite().nullable().optional(),
    available: z.boolean().nullable().optional(),
    warning: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    evidence: searchEvidenceSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // ─── Frete: cada status implica forma específica do campo freight ──
    switch (data.freightStatus) {
      case 'not_available':
        // freight não deve ser número. null ou undefined → ok.
        if (data.freight !== null && data.freight !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['freight'],
            message:
              'freight precisa ser null/undefined quando freightStatus="not_available"',
          });
        }
        break;
      case 'free_confirmed':
        if (data.freight !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['freight'],
            message:
              'freight precisa ser 0 quando freightStatus="free_confirmed"',
          });
        }
        break;
      case 'confirmed':
        if (typeof data.freight !== 'number' || data.freight <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['freight'],
            message:
              'freight precisa ser número > 0 quando freightStatus="confirmed"',
          });
        }
        break;
      case 'estimated':
        if (
          data.freight !== null &&
          data.freight !== undefined &&
          (typeof data.freight !== 'number' || data.freight < 0)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['freight'],
            message:
              'freight precisa ser número ≥ 0 quando freightStatus="estimated"',
          });
        }
        break;
    }
  });

// ─── SupplierRecipe ─────────────────────────────────────────────────────

export const supplierRecipeSchema = z.object({
  id: z.string().min(1).optional(),
  supplierId: z.string().min(1),
  status: supplierCertificationStatusSchema,
  platformDetected: z.string().nullable().optional(),
  searchUrlTemplate: z.string().nullable().optional(),
  productUrlPatterns: z.array(z.string()).optional(),
  extractionStrategy: extractionStrategySchema.nullable().optional(),
  titleSelector: z.string().nullable().optional(),
  priceSelector: z.string().nullable().optional(),
  currencySelector: z.string().nullable().optional(),
  imageSelector: z.string().nullable().optional(),
  availabilitySelector: z.string().nullable().optional(),
  jsonLdEnabled: z.boolean().optional(),
  jsonPaths: z.record(z.string(), z.unknown()).nullable().optional(),
  requiresJs: z.boolean().optional(),
  requiresBrowser: z.boolean().optional(),
  confidence: z.number().finite().nullable().optional(),
  lastTestedAt: z.string().nullable().optional(),
  lastSuccessAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  configJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ─── SupplierAutoConfigResult ───────────────────────────────────────────

export const supplierAutoConfigResultSchema = z.object({
  supplierId: z.string().min(1),
  status: supplierCertificationStatusSchema,
  platformDetected: z.string().nullable().optional(),
  searchUrlTemplate: z.string().nullable().optional(),
  confidence: z.number().finite().nullable().optional(),
  error: z.string().nullable().optional(),
  recipe: supplierRecipeSchema.nullable().optional(),
});

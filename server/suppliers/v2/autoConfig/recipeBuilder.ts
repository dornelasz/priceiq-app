/**
 * Combina os resultados dos detectores em um SupplierRecipe pronto para
 * ser persistido em supplier_recipes.
 *
 * Função PURA — não toca em I/O. O status final é definido pelo certifier;
 * aqui o status é apenas um placeholder ('unconfigured' por padrão).
 */
import type { SupplierCertificationStatus, SupplierRecipe } from '../types.js';
import type { PlatformDetectorResult } from './platformDetector.js';
import type { SearchDiscoveryResult } from './searchDiscoverer.js';
import type {
  ProductCandidate,
  ProductPageResult,
} from './productPageDetector.js';
import type { ExtractorDetectorResult } from './extractorDetector.js';

export interface RecipeBuildInput {
  supplierId: string;
  platform: PlatformDetectorResult;
  search: SearchDiscoveryResult;
  productPage: ProductPageResult | null;
  productCandidates: ProductCandidate[];
  extractor: ExtractorDetectorResult;
  defaultStatus?: SupplierCertificationStatus;
  legacyTemplate?: string | null;
  blocked?: boolean;
  requiresLogin?: boolean;
  lastError?: string | null;
}

function derivePatternsFromCandidates(candidates: ProductCandidate[]): string[] {
  const set = new Set<string>();
  for (const c of candidates.slice(0, 5)) {
    try {
      const u = new URL(c.url);
      // Normaliza IDs longos para placeholder (preserva forma do path)
      const pathTpl = u.pathname
        .replace(/-MLB-\d+/i, '-MLB-<id>')
        .replace(/\/\d{4,}(?=\/|$)/g, '/<id>')
        .replace(/\/dp\/[A-Z0-9]+/i, '/dp/<ASIN>');
      set.add(pathTpl);
    } catch {
      // ignora candidatos com URL inválida
    }
  }
  return Array.from(set).slice(0, 5);
}

function averageConfidence(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / values.length);
}

export function buildSupplierRecipe(
  input: RecipeBuildInput,
): SupplierRecipe {
  const status: SupplierCertificationStatus =
    input.defaultStatus ?? 'unconfigured';

  const productUrlPatterns = derivePatternsFromCandidates(
    input.productCandidates,
  );

  // Confiança agregada: média das partes que contribuíram
  const contributions: number[] = [];
  if (input.platform.platformDetected && input.platform.platformDetected !== 'custom') {
    contributions.push(input.platform.confidence);
  }
  if (input.search.searchUrlTemplate) {
    contributions.push(input.search.confidence);
  }
  if (input.productPage?.isProductPage) {
    contributions.push(input.productPage.confidence);
  }
  if (input.extractor.extractionStrategy) {
    contributions.push(input.extractor.confidence);
  }
  const aggregateConfidence = averageConfidence(contributions);

  return {
    supplierId: input.supplierId,
    status,
    platformDetected: input.platform.platformDetected,
    searchUrlTemplate:
      input.search.searchUrlTemplate ?? input.legacyTemplate ?? null,
    productUrlPatterns,
    extractionStrategy: input.extractor.extractionStrategy,
    titleSelector: null,
    priceSelector: null,
    currencySelector: null,
    imageSelector: null,
    availabilitySelector: null,
    jsonLdEnabled: input.extractor.jsonLdEnabled,
    jsonPaths: input.extractor.jsonPaths ?? null,
    requiresJs: input.extractor.requiresJs ?? false,
    requiresBrowser: input.extractor.requiresBrowser ?? false,
    confidence: aggregateConfidence,
    lastTestedAt: new Date().toISOString(),
    lastSuccessAt: null,
    lastError: input.lastError ?? null,
    configJson: {
      autoConfig: {
        platformSignals: input.platform.signals,
        platformConfidence: input.platform.confidence,
        searchMethod: input.search.method,
        searchConfidence: input.search.confidence,
        searchEvidence: input.search.evidence ?? null,
        productPageReasons: input.productPage?.reasons ?? [],
        productPageConfidence: input.productPage?.confidence ?? 0,
        extractorSignals: input.extractor.signals,
        extractorConfidence: input.extractor.confidence,
        candidateCount: input.productCandidates.length,
        blocked: !!input.blocked,
        requiresLogin: !!input.requiresLogin,
      },
    },
  };
}

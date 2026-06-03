/**
 * Helpers para construir UniversalSearchResult com a forma certa.
 *
 * Todo resultado parte de `baseResult()` que zera todos os campos para
 * valores seguros (frete = not_available, link = unknown, etc). Helpers
 * específicos preenchem somente o que faz sentido para o status.
 *
 * Funções PURAS.
 */
import type {
  ExtractionStrategy,
  FreightStatus,
  LinkType,
  SearchResultStatusV2,
  UniversalSearchResult,
} from '../types.js';

function baseResult(
  status: SearchResultStatusV2,
  overrides: Partial<UniversalSearchResult> = {},
): UniversalSearchResult {
  return {
    found: false,
    status,
    price: null,
    currency: null,
    freight: null,
    freightStatus: 'not_available',
    totalPrice: null,
    productUrl: null,
    linkType: 'unknown',
    linkValidated: false,
    matchScore: null,
    confidence: null,
    available: null,
    warning: null,
    errorMessage: null,
    evidence: null,
    ...overrides,
  };
}

export function buildStatusResult(
  status: SearchResultStatusV2,
  errorMessage?: string,
): UniversalSearchResult {
  return baseResult(status, {
    errorMessage: errorMessage ?? null,
  });
}

export interface ValidatedResultInput {
  productName: string;
  price: number;
  currency: string;
  productUrl: string;
  evidenceText: string;
  sourceUrl: string;
  strategy: ExtractionStrategy;
  matchScore: number;
  confidence: number;
  available?: boolean | null;
  image?: string | null;
  freight?: {
    state: FreightStatus;
    value: number | null;
    evidence: string | null;
  };
  warning?: string | null;
}

export function buildValidatedResult(
  input: ValidatedResultInput,
): UniversalSearchResult {
  const freightState = input.freight?.state ?? 'not_available';
  const freightValue =
    freightState === 'free_confirmed'
      ? 0
      : freightState === 'confirmed'
        ? (input.freight?.value ?? null)
        : null;
  const totalPrice =
    freightState === 'free_confirmed'
      ? input.price
      : freightState === 'confirmed' && typeof freightValue === 'number'
        ? input.price + freightValue
        : null;

  const linkType: LinkType = 'product';

  return baseResult('validated', {
    found: true,
    productName: input.productName,
    price: input.price,
    currency: input.currency,
    freight: freightValue,
    freightStatus: freightState,
    totalPrice,
    productUrl: input.productUrl,
    linkType,
    linkValidated: true,
    matchScore: input.matchScore,
    confidence: input.confidence,
    available: input.available ?? null,
    warning: input.warning ?? null,
    evidence: {
      sourceUrl: input.sourceUrl,
      evidenceText: input.evidenceText,
      extractedAt: new Date().toISOString(),
      strategy: input.strategy,
    },
  });
}

export interface MismatchResultInput {
  productName: string;
  productUrl: string;
  matchScore: number;
  reason: string;
}

export function buildMismatchResult(
  input: MismatchResultInput,
): UniversalSearchResult {
  return baseResult('product_mismatch', {
    productName: input.productName,
    productUrl: input.productUrl,
    linkType: 'product',
    linkValidated: false,
    matchScore: input.matchScore,
    errorMessage: input.reason,
  });
}

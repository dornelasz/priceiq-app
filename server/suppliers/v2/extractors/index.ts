/**
 * Barrel dos extractors do V2.
 *
 * `EXTRACTORS_IN_ORDER` é a lista padrão de tentativa do Recipe Runner:
 *
 *   json_ld → meta_tags → next_data → script_json → dom
 *
 * A receita pode pedir uma estratégia preferida via `extractionStrategy`;
 * o Recipe Runner tenta essa primeiro e mantém o resto como fallback.
 */
import type { ExtractionStrategy } from '../types.js';
import type { ExtractedProductData } from './types.js';
import { extractFromJsonLd } from './jsonLdExtractor.js';
import { extractFromMetaTags } from './metaTagExtractor.js';
import { extractFromNextData } from './nextDataExtractor.js';
import { extractFromScriptJson } from './scriptJsonExtractor.js';
import { extractFromDom } from './domExtractor.js';

export type ExtractorFn = (
  html: string,
  productUrl: string,
) => ExtractedProductData | null;

export interface RegisteredExtractor {
  strategy: ExtractionStrategy;
  extract: ExtractorFn;
}

export const EXTRACTORS_IN_ORDER: RegisteredExtractor[] = [
  { strategy: 'json_ld', extract: extractFromJsonLd },
  { strategy: 'meta_tags', extract: extractFromMetaTags },
  { strategy: 'next_data', extract: extractFromNextData },
  { strategy: 'script_json', extract: extractFromScriptJson },
  { strategy: 'dom', extract: extractFromDom },
];

export {
  extractFromJsonLd,
  extractFromMetaTags,
  extractFromNextData,
  extractFromScriptJson,
  extractFromDom,
};
export { detectFreeShipping, type FreightHintResult } from './freightHints.js';
export type { ExtractedProductData } from './types.js';

// ─── Etapa 4 — extractors locais reforçados ────────────────────────────
export {
  parseMoney,
  parseAmount,
  detectCurrency,
  type SupportedCurrency,
} from './moneyParser.js';

export {
  findPriceCandidates,
  rankPriceCandidates,
  pickPrincipalPrice,
  type PriceCandidate,
} from './priceCandidates.js';

export {
  extractFreight,
  type FreightExtraction,
  type FreightState,
} from './freightExtractor.js';

export { detectAvailability, type AvailabilityResult } from './availability.js';

export {
  classifyUrl,
  isProductUrl,
  type LinkClass,
  type UrlClassification,
} from './linkClassifier.js';

export {
  extractFromMarkdown,
  type MarkdownExtractInput,
} from './markdownExtractor.js';

export {
  extractLocalProduct,
  type LocalExtractionInput,
} from './localProductExtractor.js';

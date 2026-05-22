/**
 * Contrato comum dos extractors de produto.
 *
 * Cada extractor é uma função pura `(html, url) → ExtractedProductData | null`.
 * Retorna `null` quando o HTML não tem os sinais que o extractor entende.
 *
 * O resultado sempre carrega evidência textual quando o extractor consegue
 * fechar um preço — isso é o que diferencia extração validada de chute.
 */
import type { ExtractionStrategy } from '../types.js';

export interface ExtractedProductData {
  strategy: ExtractionStrategy;
  productName?: string;
  price?: number;
  currency?: string;
  productUrl?: string;
  available?: boolean;
  image?: string;
  evidenceText?: string;
  confidence: number; // 0–100
}

/**
 * AIProvider — contrato de provider de IA do motor próprio (Etapa 5).
 *
 * A IA NUNCA é fonte de preço nem de coleta. Quando (e SE) habilitada, atua
 * apenas como interpretador de conteúdo JÁ coletado por um FetchProvider,
 * devolvendo uma extração estruturada candidata. Desligada por padrão.
 *
 * O resultado de sucesso reutiliza `ExtractedProductData` — o mesmo contrato
 * de extração da Etapa 4 — para que o restante do pipeline (matching,
 * resultBuilder) trate uma extração de IA exatamente como qualquer outra.
 *
 * Apenas TIPOS — sem efeito colateral.
 */
import type { ExtractedProductData } from '../../extractors/types.js';

export type AIProviderStatus = 'success' | 'rejected' | 'disabled' | 'error';

export interface AIProviderInput {
  query: string;
  url?: string;
  html?: string;
  text?: string;
  markdown?: string;
}

export interface AIProviderResult {
  status: AIProviderStatus;
  /** Extração estruturada candidata (mesmo contrato dos extractors locais). */
  extraction?: ExtractedProductData;
  errorMessage?: string;
  elapsedMs: number;
}

export interface AIProvider {
  name: string;
  enabled: boolean;
  interpretProduct(input: AIProviderInput): Promise<AIProviderResult>;
}

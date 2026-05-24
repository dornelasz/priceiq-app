/**
 * ProviderPolicy — política de uso de providers do motor próprio (Etapa 5).
 *
 * Decide QUAIS providers o motor pode usar e em que ordem de prioridade.
 * O default reflete a decisão arquitetural: o PriceIQ é um motor próprio de
 * busca vertical; Firecrawl e IA são fallbacks OPCIONAIS, desligados por
 * padrão. O sistema principal funciona com FIRECRAWL_ENABLED=false e
 * AI_ENABLED=false.
 *
 * Função PURA.
 */

export interface ProviderPolicy {
  /** Fetcher nativo (motor próprio). Ligado por padrão. */
  nativeFetcherEnabled: boolean;
  /** Firecrawl como provider de coleta. DESLIGADO por padrão. */
  firecrawlEnabled: boolean;
  /** IA como interpretador de conteúdo já coletado. DESLIGADA por padrão. */
  aiEnabled: boolean;
  /** Prioriza o motor próprio antes de qualquer provider externo. */
  preferOwnEngine: boolean;
  /** Exige evidência textual para validar (nunca inventa preço). */
  requireEvidence: boolean;
  /** Só permite provider externo DEPOIS que o motor próprio falhar. */
  allowExternalOnlyAfterOwnFailure: boolean;
}

/**
 * Política padrão — motor próprio é prioridade; terceiros desligados.
 */
export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = {
  nativeFetcherEnabled: true,
  firecrawlEnabled: false,
  aiEnabled: false,
  preferOwnEngine: true,
  requireEvidence: true,
  allowExternalOnlyAfterOwnFailure: true,
};

/**
 * Resolve uma política completa a partir de um override parcial, preservando
 * os defaults seguros (Firecrawl/IA permanecem desligados se não citados).
 */
export function resolveProviderPolicy(
  partial?: Partial<ProviderPolicy>,
): ProviderPolicy {
  return { ...DEFAULT_PROVIDER_POLICY, ...(partial ?? {}) };
}

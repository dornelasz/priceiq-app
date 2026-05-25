/**
 * providerResolver — monta a cadeia de FetchProviders, a ProviderPolicy e os
 * overrides de orçamento a partir da configuração de ambiente (Etapa 11).
 *
 * Regras:
 *   - FIRECRAWL_ENABLED=false → só o NativeFetcher (comportamento da Etapa 7).
 *   - FIRECRAWL_ENABLED=true  → Firecrawl como coletor principal + NativeFetcher
 *     como fallback, na ordem de FETCH_PROVIDER_PRIORITY (default firecrawl,native).
 *     A FIRECRAWL_API_KEY é validada em config.ts (erro de boot se faltar).
 *
 * A chave NUNCA é exposta aqui — só é passada ao createFirecrawlProvider, que a
 * usa apenas no header Authorization.
 */
import { config } from '../../../../config.js';
import { createNativeFetchProvider } from './nativeFetcher.js';
import { createFirecrawlProvider } from './firecrawlProvider.js';
import type { FetchProvider, FetchProviderType } from './fetchProvider.js';
import type { ProviderPolicy } from './providerPolicy.js';
import type { SearchBudget } from '../core/searchBudget.js';

export interface ResolvedProviders {
  providers: FetchProvider[];
  policy: Partial<ProviderPolicy>;
  budget: Partial<SearchBudget>;
}

/** Normaliza a string CSV de prioridade em tipos de provider conhecidos. */
export function parseProviderPriority(csv: string): FetchProviderType[] {
  const known = new Set<FetchProviderType>(['firecrawl', 'native']);
  const parsed = csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FetchProviderType => known.has(s as FetchProviderType));
  // Garante que o native sempre exista como fallback.
  if (!parsed.includes('native')) parsed.push('native');
  return parsed.length > 0 ? parsed : ['native'];
}

/**
 * Resolve providers/policy/budget a partir do `config`. Aceita um override de
 * config (útil em teste, evita reimportar o módulo).
 */
export function resolveProvidersFromConfig(
  cfg: typeof config = config,
): ResolvedProviders {
  if (!cfg.FIRECRAWL_ENABLED) {
    return {
      providers: [createNativeFetchProvider()],
      policy: {
        firecrawlEnabled: false,
        preferFirecrawlFirst: false,
        providerPriority: ['native'],
      },
      budget: {},
    };
  }

  const priority = parseProviderPriority(cfg.FETCH_PROVIDER_PRIORITY);
  const firecrawl = createFirecrawlProvider({
    apiKey: cfg.FIRECRAWL_API_KEY,
    apiUrl: cfg.FIRECRAWL_API_URL,
    timeoutMs: cfg.FIRECRAWL_TIMEOUT_MS,
  });
  const native = createNativeFetchProvider();
  const byType: Record<FetchProviderType, FetchProvider | null> = {
    firecrawl,
    native,
    other: null,
  };
  const providers = priority
    .map((t) => byType[t])
    .filter((p): p is FetchProvider => p !== null);

  const maxPages = cfg.FIRECRAWL_MAX_PAGES_PER_SEARCH;

  return {
    providers,
    policy: {
      firecrawlEnabled: true,
      preferFirecrawlFirst: priority[0] === 'firecrawl',
      providerPriority: priority,
    },
    budget: {
      maxExternalFetches: maxPages,
      maxFirecrawlCalls: maxPages,
      maxFirecrawlCreditsEstimated: cfg.FIRECRAWL_MAX_CREDITS_PER_SEARCH,
      // Espaço para o NativeFetcher tentar como fallback em cada página.
      maxNativeFetches: Math.max(maxPages, 6),
      maxCandidateUrls: maxPages,
      // Cada página pode custar 2 fetches (firecrawl + native fallback) + folga.
      maxFetchesPerSupplier: maxPages * 2 + 2,
    },
  };
}

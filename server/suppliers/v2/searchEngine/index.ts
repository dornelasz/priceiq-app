/**
 * Barrel do motor próprio de busca vertical (Etapa 5 — fundação e contratos).
 *
 * Esta camada formaliza a arquitetura do motor PRÓPRIO do PriceIQ:
 *   - contexto de busca + orçamento + política de providers;
 *   - contratos de FetchProvider e AIProvider;
 *   - NativeFetcher como provider principal (motor próprio);
 *   - stubs DESLIGADOS de Firecrawl e IA (apenas contratos nesta etapa);
 *   - status internos + diagnostics em memória + helpers de decisão.
 *
 * Princípios (decisão arquitetural):
 *   - O motor próprio é prioridade. Firecrawl e IA são fallbacks OPCIONAIS,
 *     desligados por padrão (FIRECRAWL_ENABLED=false, AI_ENABLED=false).
 *   - O `localProductExtractor` (Etapa 4) continua sendo o extrator próprio
 *     principal — este motor o orquestra, não o substitui.
 *   - Nada aqui é integrado ao worker ainda; é fundação importável e pura.
 */

// ─── Core: contexto, orçamento, status, pipeline, tipos ──────────────────
export {
  createSearchEngineContext,
  normalizeSearchQuery,
  addDiagnosticAttempt,
  type SearchEngineContext,
  type SearchDiagnostics,
  type CreateSearchEngineContextInput,
} from './core/searchEngineContext.js';

export {
  DEFAULT_SEARCH_BUDGET,
  FIRECRAWL_CREDIT_ESTIMATE_PER_CALL,
  createBudgetUsage,
  resolveBudget,
  hasBudgetRemaining,
  consumeBudget,
  hasFirecrawlCreditsRemaining,
  consumeFirecrawlCredits,
  type SearchBudget,
  type BudgetUsage,
  type BudgetBearer,
  type BudgetKind,
} from './core/searchBudget.js';

export {
  SEARCH_ENGINE_INTERNAL_STATUSES,
  isUsefulInternalStatus,
  isControlledFailureStatus,
  mapInternalStatusToPublicStatus,
  type SearchEngineInternalStatus,
} from './core/searchEngineStatus.js';

export {
  SEARCH_PIPELINE_STAGES,
  ownEngineFailed,
  shouldTryExternalFetcher,
  shouldTryAI,
  selectFetchProvider,
  type SearchPipelineStage,
} from './core/searchPipeline.js';

export { type SearchEngineOutcome } from './core/searchEngineTypes.js';

// ─── Providers: política + contratos + implementações ────────────────────
export {
  DEFAULT_PROVIDER_POLICY,
  resolveProviderPolicy,
  type ProviderPolicy,
} from './providers/providerPolicy.js';

export {
  type FetchProvider,
  type FetchProviderInput,
  type FetchProviderResult,
  type FetchProviderStatus,
  type FetchProviderType,
} from './providers/fetchProvider.js';

export {
  type AIProvider,
  type AIProviderInput,
  type AIProviderResult,
  type AIProviderStatus,
} from './providers/aiProvider.js';

export {
  createNativeFetchProvider,
  type NativeFetchProviderOptions,
} from './providers/nativeFetcher.js';

export {
  createFirecrawlProviderStub,
  FIRECRAWL_DISABLED_REASON,
} from './providers/firecrawlProviderStub.js';

export {
  createFirecrawlProvider,
  buildFirecrawlScrapePayload,
  type FirecrawlProviderOptions,
} from './providers/firecrawlProvider.js';

export {
  resolveProvidersFromConfig,
  parseProviderPriority,
  type ResolvedProviders,
} from './providers/providerResolver.js';

export {
  createAIProviderStub,
  AI_DISABLED_REASON,
} from './providers/aiProviderStub.js';

// ─── Diagnostics ─────────────────────────────────────────────────────────
export {
  makeSearchAttempt,
  type SearchAttempt,
  type MakeSearchAttemptInput,
} from './diagnostics/searchAttempt.js';

// ─── Discovery: descoberta própria de URLs de produto (Etapa 6) ───────────
export {
  discoverProductUrls,
  buildDiscoverySearchUrl,
  extractUrls,
  normalizeCandidateUrl,
  removeTrackingParams,
  getSupplierDomain,
  rankCandidates,
  scoreCandidateUrl,
  tokenizeQuery,
  type DiscoveryStatus,
  type RankedCandidate,
  type DiscoveryDiagnostics,
  type DiscoverProductUrlsInput,
  type DiscoverProductUrlsResult,
  type SearchUrlSource,
  type BuildDiscoverySearchUrlInput,
  type BuildDiscoverySearchUrlResult,
  type ExtractedUrl,
  type ExtractedUrlSource,
  type ExtractUrlsInput,
  type ExtractUrlsResult,
} from './discovery/index.js';

// ─── Pipeline: motor próprio executável (Etapas 7 + 11) ───────────────────
export {
  runOwnSearchPipeline,
  mapFetchStatusToResultStatus,
  classifyExtractionForDiagnostics,
  isUsefulExtraction,
  mapToDiagnosticResponse,
  deriveDiagnosticStatus,
  sanitizeAttempts,
  fetchThroughProviders,
  canProviderFetch,
  anyProviderCanFetch,
  type RunOwnSearchPipelineInput,
  type OwnSearchPipelineOutcome,
  type DiagnosticStatus,
  type DiagnosticResultView,
  type SanitizedAttempt,
  type DiagnosticResponse,
  type DiagnosticProviderView,
  type MapDiagnosticInput,
  type ProviderChainResult,
} from './pipeline/index.js';

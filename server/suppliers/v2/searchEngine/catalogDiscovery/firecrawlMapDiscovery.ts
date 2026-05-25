/**
 * firecrawlMapDiscovery — mapeia URLs do domínio do fornecedor via Firecrawl
 * Map v2 (Etapa 15).
 *
 * Usa o endpoint /map da API Firecrawl para listar URLs do site, opcionalmente
 * com `search` para priorizar as mais relevantes à query. Devolve APENAS URLs +
 * metadados. NÃO decide preço, NÃO usa LLM/IA.
 *
 * Garantias (iguais ao FirecrawlProvider da Etapa 11):
 *   - A FIRECRAWL_API_KEY vai SOMENTE no header Authorization.
 *   - NUNCA lança: falhas viram SourceFetchStatus controlado.
 */
import { getSupplierDomain } from '../discovery/candidateUrlExtractor.js';
import { makeSearchAttempt } from '../diagnostics/searchAttempt.js';
import type { SearchEngineInternalStatus } from '../core/searchEngineStatus.js';
import type {
  DiscoveredUrl,
  SourceDiscoveryResult,
  SourceFetchStatus,
} from './catalogDiscoveryTypes.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_API_URL = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LIMIT = 50;

export interface FirecrawlMapItem {
  url: string;
  title?: string;
  description?: string;
}

export interface FirecrawlMapOutcome {
  status: SourceFetchStatus;
  items: FirecrawlMapItem[];
  httpStatus?: number;
  errorMessage?: string;
  elapsedMs: number;
}

export interface FirecrawlMapClient {
  map(
    url: string,
    opts?: { search?: string; limit?: number },
  ): Promise<FirecrawlMapOutcome>;
}

export interface FirecrawlMapClientOptions {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  enabled?: boolean;
  fetchFn?: FetchLike;
}

/** Monta o corpo do POST /map (exposto para teste). */
export function buildFirecrawlMapPayload(
  url: string,
  search: string | undefined,
  limit: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { url, limit };
  if (search && search.trim()) payload['search'] = search.trim();
  return payload;
}

/** Extrai itens da resposta v2 (links: objetos) ou v1 (links: strings). */
export function parseFirecrawlMapItems(body: unknown): FirecrawlMapItem[] {
  const raw = (body as { links?: unknown[] })?.links;
  if (!Array.isArray(raw)) return [];

  const items: FirecrawlMapItem[] = [];
  for (const entry of raw) {
    const url = typeof entry === 'string' ? entry : (entry as { url?: unknown })?.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      const meta = entry as { title?: unknown; description?: unknown };
      items.push({
        url,
        title: typeof meta?.title === 'string' ? meta.title : undefined,
        description:
          typeof meta?.description === 'string' ? meta.description : undefined,
      });
    }
  }
  return items;
}

export function createFirecrawlMapClient(
  options: FirecrawlMapClientOptions,
): FirecrawlMapClient {
  const apiKey = options.apiKey;
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const enabled = options.enabled ?? true;
  const doFetch: FetchLike = options.fetchFn ?? fetch;

  return {
    async map(url, opts): Promise<FirecrawlMapOutcome> {
      const t0 = Date.now();
      const elapsed = () => Date.now() - t0;

      if (!enabled) {
        return { status: 'disabled', items: [], elapsedMs: 0, errorMessage: 'firecrawl_disabled' };
      }
      if (!apiKey) {
        return { status: 'error', items: [], elapsedMs: elapsed(), errorMessage: 'firecrawl_api_key_missing' };
      }

      const limit = opts?.limit ?? DEFAULT_LIMIT;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(`${apiUrl}/map`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(buildFirecrawlMapPayload(url, opts?.search, limit)),
        });
        clearTimeout(timer);

        if (res.status === 401) {
          return { status: 'error', items: [], httpStatus: 401, errorMessage: 'firecrawl: chave inválida ou sem permissão', elapsedMs: elapsed() };
        }
        if (res.status === 402) {
          return { status: 'no_credits', items: [], httpStatus: 402, errorMessage: 'firecrawl: sem créditos', elapsedMs: elapsed() };
        }
        if (res.status === 429) {
          return { status: 'rate_limited', items: [], httpStatus: 429, errorMessage: 'firecrawl: limite de requisições atingido', elapsedMs: elapsed() };
        }
        if (res.status === 408 || res.status === 504) {
          return { status: 'timeout', items: [], httpStatus: res.status, errorMessage: 'firecrawl: timeout da API', elapsedMs: elapsed() };
        }
        if (!res.ok) {
          return { status: 'error', items: [], httpStatus: res.status, errorMessage: `firecrawl: HTTP ${res.status}`, elapsedMs: elapsed() };
        }

        let body: unknown;
        try {
          body = await res.json();
        } catch {
          return { status: 'error', items: [], errorMessage: 'firecrawl: resposta não é JSON válido', elapsedMs: elapsed() };
        }

        if (!(body as { success?: boolean })?.success) {
          return {
            status: 'error',
            items: [],
            errorMessage: (body as { error?: string })?.error ?? 'firecrawl: success=false',
            elapsedMs: elapsed(),
          };
        }

        return { status: 'success', items: parseFirecrawlMapItems(body), elapsedMs: elapsed() };
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).message ?? 'erro desconhecido';
        const name = (e as { name?: string }).name ?? '';
        if (/abort/i.test(name) || /abort|timeout/i.test(msg)) {
          return { status: 'timeout', items: [], errorMessage: `firecrawl: timeout após ${timeoutMs}ms`, elapsedMs: elapsed() };
        }
        return { status: 'error', items: [], errorMessage: `firecrawl: ${msg}`, elapsedMs: elapsed() };
      }
    },
  };
}

function attemptStatus(
  fetchStatus: SourceFetchStatus,
  hasItems: boolean,
): SearchEngineInternalStatus {
  switch (fetchStatus) {
    case 'success':
      return hasItems ? 'external_fetch_success' : 'candidate_not_found';
    case 'blocked':
      return 'blocked';
    case 'timeout':
      return 'timeout';
    case 'disabled':
      return 'external_provider_disabled';
    default:
      return 'external_fetch_failed';
  }
}

export interface DiscoverViaFirecrawlMapInput {
  supplier: { site: string };
  query: string;
  maxItems?: number;
}

/**
 * Executa a descoberta via Firecrawl Map e devolve um SourceDiscoveryResult.
 * Mapeia o domínio do fornecedor, usando a query como `search` para priorizar.
 */
export async function discoverViaFirecrawlMap(
  input: DiscoverViaFirecrawlMapInput,
  client: FirecrawlMapClient,
): Promise<SourceDiscoveryResult> {
  const domain = getSupplierDomain(input.supplier);
  const baseUrl = `https://${domain}`;
  const outcome = await client.map(baseUrl, {
    search: input.query,
    limit: input.maxItems,
  });

  const urls: DiscoveredUrl[] = outcome.items.map((it) => ({
    url: it.url,
    title: it.title,
  }));

  const attempts = [
    makeSearchAttempt({
      step: 'firecrawl_map',
      status: attemptStatus(outcome.status, urls.length > 0),
      providerName: 'firecrawl',
      detail: `map ${baseUrl} (search "${input.query}") → ${urls.length} URL(s) (${outcome.status})`,
      httpStatus: outcome.httpStatus,
      elapsedMs: outcome.elapsedMs,
    }),
  ];

  return {
    source: 'firecrawl_map',
    fetchStatus: outcome.status,
    urls,
    attempts,
    errorMessage: outcome.errorMessage,
  };
}

/**
 * Cliente da API PriceIQ.
 * Todas as chamadas vão pelo backend Fastify — NUNCA chama Gemini/Jina direto.
 * URL base é resolvida no servidor via NEXT_PUBLIC_API_URL e no browser via /api
 * (Next.js rewrite faz proxy).
 */
import type {
  ApiError, RatesPayload, Search, SearchCreatedResponse, SearchResult, SearchResultsResponse, Supplier, SupplierInput,
} from './types';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || '';

function buildUrl(path: string): string {
  // No browser, usa caminho relativo (Next rewrite cuida do proxy).
  // No servidor (SSR), precisa de URL absoluta.
  if (typeof window !== 'undefined') return path;
  if (BASE_URL) return `${BASE_URL}${path}`;
  return path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: ApiError | undefined;
    try { body = (await res.json()) as ApiError; } catch { /* ignora */ }
    const msg = body?.message || `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; body?: ApiError };
    err.status = res.status;
    if (body) err.body = body;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Suppliers ───────────────────────────────────────────

export const suppliersApi = {
  list: () => request<{ items: Supplier[] }>('/api/suppliers'),
  create: (body: SupplierInput) =>
    request<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<SupplierInput>) =>
    request<Supplier>(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<void>(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

// ─── Searches ────────────────────────────────────────────

export const searchesApi = {
  create: (query: string, supplierIds?: string[], forceRefresh = false) =>
    request<SearchCreatedResponse>('/api/searches', {
      method: 'POST',
      body: JSON.stringify({ query, supplierIds, forceRefresh }),
    }),
  list: (limit = 20, offset = 0) =>
    request<{ items: Search[]; limit: number; offset: number }>(
      `/api/searches?limit=${limit}&offset=${offset}`,
    ),
  get: (id: string) => request<Search>(`/api/searches/${id}`),
  results: (id: string) =>
    request<SearchResultsResponse>(`/api/searches/${id}/results`),
};

// Re-export para conveniência de quem só precisa do tipo SearchResult
export type { SearchResult };

// ─── Rates ───────────────────────────────────────────────

export const ratesApi = {
  current: () => request<RatesPayload>('/api/rates'),
  refresh: () => request<RatesPayload>('/api/rates/refresh', { method: 'POST' }),
};

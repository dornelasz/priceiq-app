/**
 * Firecrawl — scraping API que retorna markdown limpo.
 *
 * Requer API key (FIRECRAWL_API_KEY). Endpoint: POST /v1/scrape.
 * Alternativa ao Jina para sites que Jina não consegue.
 */

const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/scrape';
const MAX_CONTENT_LENGTH = 100_000;

export interface FirecrawlResult {
  ok: boolean;
  markdown: string;
  error?: string;
}

export async function fetchViaFirecrawl(
  url: string,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<FirecrawlResult> {
  if (!apiKey) {
    return { ok: false, markdown: '', error: 'FIRECRAWL_API_KEY não configurada' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FIRECRAWL_API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        timeout: Math.floor(timeoutMs / 1000),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    clearTimeout(timer);

    if (!res.ok) {
      const errMsg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      return { ok: false, markdown: '', error: `Firecrawl: ${errMsg}` };
    }

    const data = json.data as { markdown?: string } | undefined;
    const md = data?.markdown ?? '';
    if (md.length < 50) {
      return { ok: false, markdown: '', error: 'Firecrawl retornou conteúdo vazio' };
    }
    return {
      ok: true,
      markdown: md.slice(0, MAX_CONTENT_LENGTH),
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, markdown: '', error: (e as Error).message };
  }
}

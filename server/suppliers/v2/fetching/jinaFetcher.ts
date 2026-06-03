/**
 * Jina Reader — converte qualquer URL em markdown limpo via r.jina.ai.
 *
 * Free tier sem API key. Renderiza JS, contorna Cloudflare em muitos casos.
 * Retorna texto/markdown pronto para extração por regex.
 */

const JINA_BASE = 'https://r.jina.ai/';
const MAX_CONTENT_LENGTH = 100_000;

export interface JinaResult {
  ok: boolean;
  markdown: string;
  error?: string;
}

export async function fetchViaJina(
  url: string,
  timeoutMs = 15_000,
): Promise<JinaResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${JINA_BASE}${url}`, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
        'X-Timeout': String(Math.min(Math.floor(timeoutMs / 1000), 30)),
      },
    });
    const text = await res.text().catch(() => '');
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, markdown: '', error: `Jina HTTP ${res.status}` };
    }
    if (text.length < 50) {
      return { ok: false, markdown: '', error: 'Jina retornou conteúdo vazio' };
    }
    return {
      ok: true,
      markdown: text.slice(0, MAX_CONTENT_LENGTH),
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, markdown: '', error: (e as Error).message };
  }
}

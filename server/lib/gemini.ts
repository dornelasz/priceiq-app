/**
 * Cliente Gemini — chamado SEMPRE pelo backend, nunca pelo frontend.
 *
 * A chave (GEMINI_API_KEY) vive em .env do servidor. Frontend não recebe
 * a chave e não chama Gemini diretamente.
 */
import { config } from '../config.js';

export class GeminiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiCallOptions {
  prompt: string;
  maxTokens?: number;
  useSearch?: boolean;
  timeoutMs?: number;
}

export async function callGemini(opts: GeminiCallOptions): Promise<string> {
  const { prompt, maxTokens = 1500, useSearch = false, timeoutMs = 25_000 } = opts;
  if (!config.GEMINI_API_KEY) {
    throw new GeminiError('GEMINI_API_KEY não configurada no servidor', 503);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;

  interface GeminiBody {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    generationConfig: { temperature: number; maxOutputTokens: number };
    tools?: Array<{ google_search: Record<string, never> }>;
  }
  const body: GeminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await r.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      error?: { message?: string };
    };
    if (!r.ok) {
      throw new GeminiError(data?.error?.message ?? `Gemini HTTP ${r.status}`, r.status);
    }
    const out = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('\n')
      .trim();
    if (!out) {
      throw new GeminiError(`Gemini respondeu vazio: ${data.candidates?.[0]?.finishReason ?? 'sem motivo'}`);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse defensivo de JSON da resposta Gemini — aceita markdown fences,
 * texto extra antes/depois, vírgulas trailing.
 */
export function parseJsonFromGemini(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  // Tenta direto
  try {
    return JSON.parse(raw);
  } catch {
    // fall-through
  }
  // ```json ... ```
  let m = raw.match(/```json\s*([\s\S]*?)```/i);
  if (m && m[1]) {
    try {
      return JSON.parse(m[1].trim());
    } catch {
      // fall-through
    }
  }
  // ``` ... ```
  m = raw.match(/```\s*([\s\S]*?)```/);
  if (m && m[1]) {
    try {
      return JSON.parse(m[1].trim());
    } catch {
      // fall-through
    }
  }
  // Maior objeto JSON dentro do texto
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s > -1 && e > s) {
    const slice = raw.slice(s, e + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // tenta limpar vírgulas trailing
      try {
        return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        // fall-through
      }
    }
  }
  return null;
}

export function isQuotaError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('exceeded')
  );
}

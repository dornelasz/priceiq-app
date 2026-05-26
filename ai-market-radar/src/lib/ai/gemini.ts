import { env } from "../env";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function isAiConfigured(): boolean {
  return env.isAiConfigured;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
}

/**
 * Call Gemini's generateContent endpoint. The API key + model come ONLY from
 * env (never hardcoded). Throws on misconfiguration or a non-OK response.
 */
export async function generateContent(
  prompt: string,
  opts: { json?: boolean; temperature?: number } = {},
): Promise<string> {
  const key = env.geminiApiKey;
  if (!key) throw new Error("GEMINI_API_KEY não configurada.");
  const model = env.geminiModel;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(env.fetchTimeoutMs, 30000));

  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Gemini respondeu HTTP ${res.status}`);
    }
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Conteúdo bloqueado pela Gemini: ${data.promptFeedback.blockReason}`);
    }
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("Resposta vazia da Gemini.");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/** Lightweight connectivity check used by /settings → "Testar Gemini API". */
export async function testConnection(): Promise<{
  ok: boolean;
  configured: boolean;
  model: string;
  message: string;
}> {
  const model = env.geminiModel;
  if (!isAiConfigured()) {
    return {
      ok: false,
      configured: false,
      model,
      message: "GEMINI_API_KEY não configurada — o sistema funciona sem IA (notícias ficam pendentes de análise).",
    };
  }
  try {
    const reply = await generateContent('Responda apenas com a palavra: OK', {
      temperature: 0,
    });
    return {
      ok: true,
      configured: true,
      model,
      message: `Conexão OK. Resposta do modelo: "${reply.trim().slice(0, 40)}"`,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      model,
      message: err instanceof Error ? err.message : "Falha desconhecida ao contatar a Gemini.",
    };
  }
}

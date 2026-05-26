import { env } from "../env";

/**
 * Fetch text with a transparent User-Agent and a timeout. We never bypass
 * paywalls, captchas or auth — a non-OK response is surfaced as an error so
 * the source is marked failed (and other sources keep running).
 */
export async function fetchText(
  url: string,
  opts: { accept?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.fetchTimeoutMs);
  const signal = opts.signal ?? controller.signal;

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        "User-Agent": env.httpUserAgent,
        Accept: opts.accept ?? "*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} ao buscar ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

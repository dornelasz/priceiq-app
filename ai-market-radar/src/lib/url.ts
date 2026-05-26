import { createHash } from "node:crypto";

// Query params that are pure tracking noise and must be stripped before
// we treat two URLs as "the same" article.
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_reader",
  "utm_name",
  "utm_social",
  "utm_brand",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "spm",
  "yclid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "wt_mc",
  "cmpid",
]);

function stripTrackingParams(params: URLSearchParams): URLSearchParams {
  const cleaned = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (lower.startsWith("utm_")) continue;
    cleaned.append(key, value);
  }
  // Stable ordering so the canonical form is deterministic.
  cleaned.sort();
  return cleaned;
}

/**
 * Normalize a URL into a canonical form for deduplication:
 * - lowercases scheme + host
 * - forces https for http (most outlets serve both)
 * - drops default ports, fragments and tracking params
 * - removes a trailing slash (except on the root path)
 * Invalid URLs are returned trimmed (never throws).
 */
export function normalizeUrl(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  url.protocol = url.protocol.toLowerCase();
  if (url.protocol === "http:") url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  const cleanedParams = stripTrackingParams(url.searchParams);
  url.search = cleanedParams.toString();

  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  url.pathname = pathname || "/";

  return url.toString();
}

// Alias — explicit "canonical" naming used across the codebase.
export const canonicalizeUrl = normalizeUrl;

/**
 * Deterministic content hash used as a secondary dedup signal.
 * Built from canonical URL + normalized title (+ optional excerpt).
 */
export function contentHash(input: {
  url: string;
  title: string;
  excerpt?: string | null;
}): string {
  const url = normalizeUrl(input.url);
  const title = normalizeTitle(input.title);
  const excerpt = (input.excerpt ?? "").trim().slice(0, 500);
  return createHash("sha256").update(`${url}\n${title}\n${excerpt}`).digest("hex");
}

/** Lowercase, strip punctuation, collapse whitespace — for comparison only. */
export function normalizeTitle(title: string): string {
  return (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-set (Jaccard) similarity between two titles, range 0..1.
 * Used to flag "very similar" titles from the same source as duplicates.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const tok of ta) if (tb.has(tok)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isSimilarTitle(a: string, b: string, threshold = 0.82): boolean {
  if (normalizeTitle(a) === normalizeTitle(b)) return true;
  return titleSimilarity(a, b) >= threshold;
}

import type { ArticleType, Relevance, SourceType } from "@prisma/client";

export const SOURCE_TYPES: SourceType[] = [
  "RSS",
  "BLOG",
  "SITE",
  "PAPER",
  "GITHUB",
  "PRODUCT_LAUNCH",
  "OTHER",
];

export const RELEVANCE_LEVELS: Relevance[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const ARTICLE_TYPES: ArticleType[] = [
  "NEWS",
  "LAUNCH",
  "RESEARCH",
  "TOOL",
  "INVESTMENT",
  "REGULATION",
  "PRODUCT_UPDATE",
  "TREND",
  "OPINION",
];

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as string[]).includes(value);
}

export function isRelevance(value: unknown): value is Relevance {
  return typeof value === "string" && (RELEVANCE_LEVELS as string[]).includes(value);
}

export function isArticleType(value: unknown): value is ArticleType {
  return typeof value === "string" && (ARTICLE_TYPES as string[]).includes(value);
}

/** Relevance levels at or above `min` (for "minimum relevance" filters). */
export function relevanceAtLeast(min: string): Relevance[] | undefined {
  const i = RELEVANCE_LEVELS.indexOf(min as Relevance);
  return i < 0 ? undefined : RELEVANCE_LEVELS.slice(i);
}

export function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

import * as cheerio from "cheerio";
import { fetchText } from "./http";
import { cleanText, toDateOrNull, type CollectedItem } from "./types";

/**
 * Extract a single article-like item from a public HTML page.
 * Pure (no network) so it can be unit-tested with a fixture.
 * For "simple" public pages only — we do not bypass any access control.
 */
export function extractFromHtml(html: string, url: string, sourceName: string): CollectedItem {
  const $ = cheerio.load(html);

  const meta = (selector: string, attr = "content"): string | null => {
    const v = $(selector).first().attr(attr);
    return v ? v.trim() : null;
  };

  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    $("title").first().text().trim() ??
    $("h1").first().text().trim();

  const excerpt =
    meta('meta[name="description"]') ??
    meta('meta[property="og:description"]') ??
    meta('meta[name="twitter:description"]');

  const publishedRaw =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    meta('meta[itemprop="datePublished"]') ??
    $("time[datetime]").first().attr("datetime") ??
    null;

  const author =
    meta('meta[name="author"]') ?? meta('meta[property="article:author"]') ?? null;

  const language = $("html").attr("lang")?.trim() ?? null;

  // Main content: prefer <article>/<main>, fall back to body paragraphs.
  let container = $("article").first();
  if (container.length === 0) container = $("main").first();
  if (container.length === 0) container = $("body");
  container.find("script, style, nav, header, footer, aside, form").remove();
  const content = cleanText(container.text());

  return {
    title: (title || sourceName).trim(),
    url,
    publishedAt: toDateOrNull(publishedRaw),
    excerpt: excerpt ? cleanText(excerpt, 600) : content ? content.slice(0, 600) : null,
    content,
    sourceName,
    author,
    language,
  };
}

export async function collectWebPage(input: {
  url: string;
  sourceName: string;
  signal?: AbortSignal;
}): Promise<CollectedItem[]> {
  const html = await fetchText(input.url, {
    accept: "text/html,application/xhtml+xml",
    signal: input.signal,
  });
  return [extractFromHtml(html, input.url, input.sourceName)];
}

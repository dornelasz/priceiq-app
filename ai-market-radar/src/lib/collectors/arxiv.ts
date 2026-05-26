import { fetchText } from "./http";
import { parseRssFeed } from "./rss";
import type { CollectedItem } from "./types";

// arXiv exposes stable public RSS feeds (e.g. http://export.arxiv.org/rss/cs.AI)
// and an Atom export API. Both are RSS/Atom, so we reuse the RSS parser and
// just tag the language. No scraping, no paywall.
export async function collectArxiv(input: {
  url: string;
  sourceName: string;
  signal?: AbortSignal;
}): Promise<CollectedItem[]> {
  const xml = await fetchText(input.url, {
    accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
    signal: input.signal,
  });
  const items = await parseRssFeed(xml, input.sourceName);
  return items.map((item) => ({ ...item, language: item.language ?? "en" }));
}

export function isArxivUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("arxiv.org");
  } catch {
    return false;
  }
}

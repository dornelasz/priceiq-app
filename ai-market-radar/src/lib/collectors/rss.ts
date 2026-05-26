import Parser from "rss-parser";
import { fetchText } from "./http";
import { cleanText, toDateOrNull, type CollectedItem } from "./types";

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
};

const parser: Parser<{ language?: string }, FeedItem> = new Parser({
  customFields: {
    item: [
      ["dc:creator", "creator"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

/**
 * Parse a raw RSS/Atom XML string into universal items.
 * Pure (no network) so it is unit-testable with a fixture.
 */
export async function parseRssFeed(xml: string, sourceName: string): Promise<CollectedItem[]> {
  const feed = await parser.parseString(xml);
  const language = feed.language ?? null;

  const items: CollectedItem[] = [];
  for (const item of feed.items ?? []) {
    const url = (item.link ?? item.guid ?? "").trim();
    const title = (item.title ?? "").trim();
    if (!url || !title) continue;

    const content = cleanText(item.contentEncoded ?? item.content ?? item.summary ?? null);
    const excerpt =
      cleanText(item.contentSnippet ?? item.summary ?? content, 600) ??
      (content ? content.slice(0, 600) : null);

    items.push({
      title,
      url,
      publishedAt: toDateOrNull(item.isoDate ?? item.pubDate ?? null),
      excerpt,
      content,
      sourceName,
      author: (item.creator ?? item.author ?? null) || null,
      language,
    });
  }
  return items;
}

export async function collectRss(input: {
  url: string;
  sourceName: string;
  signal?: AbortSignal;
}): Promise<CollectedItem[]> {
  const xml = await fetchText(input.url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    signal: input.signal,
  });
  return parseRssFeed(xml, input.sourceName);
}

import { describe, expect, it } from "vitest";
import { parseRssFeed } from "../src/lib/collectors/rss";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example AI Feed</title>
    <language>en</language>
    <item>
      <title>OpenAI launches new model</title>
      <link>https://openai.com/blog/new-model?utm_source=rss</link>
      <pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate>
      <description>A short description of the launch.</description>
    </item>
    <item>
      <title>Item without a link</title>
      <description>should be skipped</description>
    </item>
  </channel>
</rss>`;

describe("parseRssFeed", () => {
  it("parses items and skips entries without a link", async () => {
    const items = await parseRssFeed(FEED, "Example AI Feed");
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.title).toContain("OpenAI");
    expect(item.url).toContain("openai.com");
    expect(item.publishedAt).toBeInstanceOf(Date);
    expect(item.publishedAt?.getUTCFullYear()).toBe(2025);
    expect(item.excerpt).toBeTruthy();
    expect(item.sourceName).toBe("Example AI Feed");
    expect(item.language).toBe("en");
  });

  it("returns an empty array for a feed with no items", async () => {
    const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    expect(await parseRssFeed(empty, "Empty")).toEqual([]);
  });
});

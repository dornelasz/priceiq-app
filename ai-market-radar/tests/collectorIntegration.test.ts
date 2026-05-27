import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runIsolated } from "../src/lib/async";
import { collectSource } from "../src/lib/collectors";
import { planIngest } from "../src/lib/ingest";

// A small, valid RSS feed served over real HTTP (localhost). This exercises the
// full collector path (fetch → parse → universal item) without depending on any
// remote network, plus deduplication across two runs and failure isolation.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Fixture AI Feed</title><language>en</language>
  <item>
    <title>OpenAI launches a new model</title>
    <link>https://example.com/news/new-model?utm_source=rss&amp;utm_medium=feed</link>
    <pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate>
    <description>An open-source agent release with a new API.</description>
  </item>
  <item>
    <title>Funding round for an AI startup</title>
    <link>https://example.com/news/funding</link>
    <pubDate>Thu, 02 Jan 2025 09:30:00 GMT</pubDate>
    <description>Investment news in enterprise automation.</description>
  </item>
</channel></rss>`;

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/feed.xml") {
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.end(FEED);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("collector integration (HTTP fixture)", () => {
  it("collects items over HTTP and parses real fields", async () => {
    const { items, warnings } = await collectSource({
      url: `${base}/feed.xml`,
      name: "Fixture",
      type: "RSS",
    });
    expect(warnings).toEqual([]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("OpenAI");
    expect(items[0].url).toContain("https://example.com/");
    expect(items[0].publishedAt).toBeInstanceOf(Date);
    expect(items[0].excerpt).toBeTruthy();
  });

  it("deduplicates across two consecutive runs (URL + hash)", async () => {
    const { items } = await collectSource({ url: `${base}/feed.xml`, name: "Fixture", type: "RSS" });

    const first = planIngest(items, "s1", []);
    expect(first.toCreate).toHaveLength(2);

    // Feed the first run's outputs as "already stored", then re-ingest the SAME feed.
    const existing = first.toCreate.map((a) => ({
      canonicalUrl: a.canonicalUrl,
      contentHash: a.contentHash,
      title: a.title,
      sourceId: a.sourceId,
    }));
    const second = planIngest(items, "s1", existing);
    expect(second.toCreate).toHaveLength(0);
    expect(second.duplicates).toHaveLength(2);
  });

  it("isolates a failing source without aborting the others", async () => {
    const urls = [`${base}/feed.xml`, "http://127.0.0.1:1/feed.xml", `${base}/feed.xml`];
    const { results, errors } = await runIsolated(urls, (u) =>
      collectSource({ url: u, name: "s", type: "RSS" }),
    );
    expect(results).toHaveLength(2); // the two reachable sources succeeded
    expect(errors).toHaveLength(1); // the unreachable one failed in isolation
  });
});

import { describe, expect, it } from "vitest";
import type { ExistingArticleRef } from "../src/lib/dedup";
import { buildArticleInput, planIngest } from "../src/lib/ingest";
import type { CollectedItem } from "../src/lib/collectors/types";

function item(partial: Partial<CollectedItem>): CollectedItem {
  return {
    title: "Untitled",
    url: "https://example.com/a",
    publishedAt: null,
    excerpt: null,
    content: null,
    sourceName: "Src",
    author: null,
    language: null,
    ...partial,
  };
}

describe("buildArticleInput", () => {
  it("canonicalizes the URL, hashes content and scores relevance", () => {
    const input = buildArticleInput(
      item({
        title: "OpenAI launches new model with open-source weights",
        url: "https://openai.com/blog/x?utm_source=rss",
        excerpt: "A funding round and a new agent API.",
      }),
      "src-1",
    );
    expect(input.canonicalUrl).toBe("https://openai.com/blog/x");
    expect(input.contentHash).toHaveLength(64);
    expect(input.sourceId).toBe("src-1");
    expect(input.localScore).toBeGreaterThan(0);
  });
});

describe("planIngest", () => {
  it("creates new articles and drops duplicates of existing ones", () => {
    const existing: ExistingArticleRef[] = [
      { canonicalUrl: "https://example.com/old", contentHash: "x", title: "Old", sourceId: "s1" },
    ];
    const items = [
      item({ title: "Brand new launch", url: "https://example.com/new" }),
      item({ title: "Old", url: "https://example.com/old?utm_source=z" }), // dup by URL
      item({ title: "", url: "https://example.com/empty" }), // invalid (no title)
    ];

    const plan = planIngest(items, "s1", existing);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].canonicalUrl).toBe("https://example.com/new");
    expect(plan.duplicates.some((d) => d.reason === "url")).toBe(true);
    expect(plan.invalid).toBe(1);
  });

  it("de-duplicates within a single batch", () => {
    const items = [
      item({ title: "Same", url: "https://example.com/p" }),
      item({ title: "Same", url: "https://example.com/p?utm_source=a" }),
    ];
    const plan = planIngest(items, "s1", []);
    expect(plan.toCreate).toHaveLength(1);
  });
});

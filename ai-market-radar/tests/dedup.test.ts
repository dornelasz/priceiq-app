import { describe, expect, it } from "vitest";
import { dedupeBatch, findDuplicate, type ExistingArticleRef } from "../src/lib/dedup";

const existing: ExistingArticleRef[] = [
  {
    canonicalUrl: "https://site.com/a",
    contentHash: "hash-a",
    title: "OpenAI launches new model",
    sourceId: "s1",
  },
];

describe("findDuplicate", () => {
  it("detects duplicate by canonical URL (ignoring tracking params)", () => {
    const match = findDuplicate(
      { canonicalUrl: "https://site.com/a?utm_source=x", contentHash: "z", title: "X", sourceId: "s9" },
      existing,
    );
    expect(match?.reason).toBe("url");
  });

  it("detects duplicate by content hash", () => {
    const match = findDuplicate(
      { canonicalUrl: "https://site.com/other", contentHash: "hash-a", title: "X", sourceId: "s9" },
      existing,
    );
    expect(match?.reason).toBe("hash");
  });

  it("detects very similar title from the SAME source", () => {
    const match = findDuplicate(
      {
        canonicalUrl: "https://site.com/b",
        contentHash: "h2",
        title: "OpenAI launches new model!",
        sourceId: "s1",
      },
      existing,
    );
    expect(match?.reason).toBe("similar-title");
  });

  it("does NOT match similar title from a different source", () => {
    const match = findDuplicate(
      {
        canonicalUrl: "https://site.com/b",
        contentHash: "h2",
        title: "OpenAI launches new model!",
        sourceId: "other",
      },
      existing,
    );
    expect(match).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const match = findDuplicate(
      { canonicalUrl: "https://new.com/z", contentHash: "h3", title: "Totally different", sourceId: "s1" },
      existing,
    );
    expect(match).toBeNull();
  });
});

describe("dedupeBatch", () => {
  it("drops duplicates within the same batch", () => {
    const { unique, dropped } = dedupeBatch([
      { canonicalUrl: "https://x.com/1", contentHash: "a", title: "t1", sourceId: "s" },
      { canonicalUrl: "https://x.com/1?utm_source=y", contentHash: "b", title: "t1", sourceId: "s" },
      { canonicalUrl: "https://x.com/2", contentHash: "c", title: "t2", sourceId: "s" },
    ]);
    expect(unique).toHaveLength(2);
    expect(dropped).toBe(1);
  });
});

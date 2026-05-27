import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  contentHash,
  isSimilarTitle,
  normalizeUrl,
  titleSimilarity,
} from "../src/lib/url";

describe("normalizeUrl", () => {
  it("strips tracking params, www, trailing slash and fragment", () => {
    const got = normalizeUrl("HTTP://www.Example.com/Post/?utm_source=rss&id=5&gclid=abc#section");
    expect(got).toBe("https://example.com/Post?id=5");
  });

  it("treats URLs differing only by tracking params as identical", () => {
    const a = canonicalizeUrl("https://site.com/a?utm_campaign=x&ref=twitter");
    const b = canonicalizeUrl("https://site.com/a");
    expect(a).toBe(b);
  });

  it("keeps the root path intact", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("returns input trimmed when not a valid URL", () => {
    expect(normalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("contentHash", () => {
  it("is deterministic for the same inputs", () => {
    const a = contentHash({ url: "https://x.com/a?utm_source=y", title: "Hello" });
    const b = contentHash({ url: "https://x.com/a", title: "Hello" });
    expect(a).toBe(b);
  });

  it("changes when the title changes", () => {
    const a = contentHash({ url: "https://x.com/a", title: "Hello" });
    const b = contentHash({ url: "https://x.com/a", title: "World" });
    expect(a).not.toBe(b);
  });
});

describe("titleSimilarity", () => {
  it("is high for near-identical titles and low for different ones", () => {
    expect(titleSimilarity("OpenAI launches GPT-5", "OpenAI launches GPT-5 today")).toBeGreaterThan(
      0.6,
    );
    expect(isSimilarTitle("OpenAI launches GPT-5", "OpenAI launches GPT-5!")).toBe(true);
    expect(titleSimilarity("Apple ships new chip", "Regulators debate AI law")).toBeLessThan(0.2);
  });
});

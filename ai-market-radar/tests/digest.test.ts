import { describe, expect, it } from "vitest";
import { buildDigest, type DigestArticle } from "../src/lib/digest";

function article(partial: Partial<DigestArticle>): DigestArticle {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Untitled",
    url: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    publishedAt: new Date("2025-01-01T10:00:00Z"),
    localScore: 0,
    sourceName: "Src",
    analysis: null,
    ...partial,
  };
}

const analysis = (over: Partial<NonNullable<DigestArticle["analysis"]>> = {}) => ({
  relevance: "MEDIUM" as const,
  articleType: "NEWS" as const,
  category: "Modelos de IA",
  companies: [],
  technologies: [],
  keywords: [],
  summary: "s",
  impact: "i",
  ...over,
});

describe("buildDigest", () => {
  it("aggregates only real articles: top list, companies, tools and counts", () => {
    const articles: DigestArticle[] = [
      article({
        id: "crit",
        title: "Critical launch",
        localScore: 30,
        analysis: analysis({ relevance: "CRITICAL", companies: ["OpenAI"], keywords: ["agents"] }),
      }),
      article({
        id: "tool",
        title: "New AI tool",
        localScore: 10,
        analysis: analysis({ relevance: "MEDIUM", articleType: "TOOL", companies: ["OpenAI", "Google"] }),
      }),
      article({ id: "low", title: "Minor note", localScore: 1, analysis: null }),
    ];

    const digest = buildDigest(articles, "2025-01-01");

    expect(digest.totalArticles).toBe(3);
    // Highest relevance first.
    expect(digest.topArticles[0].id).toBe("crit");
    expect(digest.topArticles[0].relevance).toBe("CRITICAL");
    // Company tally counts OpenAI twice.
    const openai = digest.companies.find((c) => c.name === "OpenAI");
    expect(openai?.count).toBe(2);
    // Tool detected.
    expect(digest.newTools.map((t) => t.id)).toContain("tool");
    // Factual summary mentions the count.
    expect(digest.summary).toContain("3 notícia");
  });

  it("handles an empty day without inventing anything", () => {
    const digest = buildDigest([], "2025-01-02");
    expect(digest.totalArticles).toBe(0);
    expect(digest.topArticles).toEqual([]);
    expect(digest.companies).toEqual([]);
    expect(digest.newTools).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeArticle, parseAnalysisResponse } from "../src/lib/ai/analyze";

describe("parseAnalysisResponse", () => {
  it("parses fenced JSON, clamps enums, normalizes category and dedupes arrays", () => {
    const reply =
      "```json\n" +
      JSON.stringify({
        summary: "Resumo objetivo.",
        impact: "Impacto.",
        category: "agents",
        relevance: "super-high",
        articleType: "weird",
        companies: ["OpenAI", "openai", "Google"],
        technologies: ["GPT-5"],
        keywords: ["a", "b"],
      }) +
      "\n```";

    const result = parseAnalysisResponse(reply, "gemini-test");
    expect(result.category).toBe("Agentes de IA");
    expect(result.relevance).toBe("MEDIUM"); // invalid → safe default
    expect(result.articleType).toBe("NEWS"); // invalid → safe default
    expect(result.companies).toEqual(["OpenAI", "Google"]); // case-insensitive dedupe
    expect(result.aiModel).toBe("gemini-test");
  });

  it("throws on unparseable output", () => {
    expect(() => parseAnalysisResponse("not json at all", "m")).toThrow();
  });

  it("throws when the summary is missing", () => {
    expect(() => parseAnalysisResponse(JSON.stringify({ impact: "x" }), "m")).toThrow();
  });
});

describe("analyzeArticle without Gemini configured", () => {
  const original = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  });

  it("returns null (never fabricates an analysis)", async () => {
    const result = await analyzeArticle({
      title: "Some AI news",
      url: "https://example.com/x",
      excerpt: "excerpt",
      content: "content",
    });
    expect(result).toBeNull();
  });
});

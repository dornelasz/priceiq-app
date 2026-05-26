import type { ArticleType, Relevance } from "@prisma/client";
import { normalizeCategory } from "../categories";
import { generateContent, isAiConfigured } from "./gemini";
import { ARTICLE_TYPES, RELEVANCE_LEVELS, buildAnalysisPrompt, type AnalysisInput } from "./prompt";
import { env } from "../env";

export interface AnalysisResult {
  summary: string;
  impact: string;
  category: string;
  relevance: Relevance;
  articleType: ArticleType;
  companies: string[];
  technologies: string[];
  keywords: string[];
  aiModel: string;
}

const RELEVANCE_SET = new Set<string>(RELEVANCE_LEVELS);
const ARTICLE_TYPE_SET = new Set<string>(ARTICLE_TYPES);

function asStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}

function clampRelevance(value: unknown): Relevance {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (RELEVANCE_SET.has(v) ? v : "MEDIUM") as Relevance;
}

function clampArticleType(value: unknown): ArticleType {
  const v = typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : "";
  return (ARTICLE_TYPE_SET.has(v) ? v : "NEWS") as ArticleType;
}

/** Extract the first JSON object from a model reply (tolerates code fences). */
function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
  }
}

/**
 * Parse + sanitize a raw model reply into an AnalysisResult.
 * Pure (no network) so it is unit-testable. Throws if the reply is unparseable.
 */
export function parseAnalysisResponse(text: string, model: string): AnalysisResult {
  const raw = extractJson(text) as Record<string, unknown>;
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const impact = typeof raw.impact === "string" ? raw.impact.trim() : "";
  if (!summary) throw new Error("Resposta da IA sem 'summary'.");

  return {
    summary: summary.slice(0, 2000),
    impact: impact.slice(0, 2000),
    category: normalizeCategory(typeof raw.category === "string" ? raw.category : null),
    relevance: clampRelevance(raw.relevance),
    articleType: clampArticleType(raw.articleType),
    companies: asStringArray(raw.companies),
    technologies: asStringArray(raw.technologies),
    keywords: asStringArray(raw.keywords),
    aiModel: model,
  };
}

/**
 * Analyze a single article with Gemini.
 * Returns null when AI is NOT configured — the caller keeps the article as
 * "pending analysis". Never fabricates an analysis.
 */
export async function analyzeArticle(input: AnalysisInput): Promise<AnalysisResult | null> {
  if (!isAiConfigured()) return null;
  const prompt = buildAnalysisPrompt(input);
  const reply = await generateContent(prompt, { json: true, temperature: 0.2 });
  return parseAnalysisResponse(reply, env.geminiModel);
}

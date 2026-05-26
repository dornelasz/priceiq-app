import type { Relevance } from "@prisma/client";

// Lightweight, deterministic keyword scoring. This is the LOCAL signal that
// always runs (even without AI) and feeds sorting + the hybrid relevance.
// It never invents anything — it only measures the collected text.
const KEYWORD_WEIGHTS: Record<string, number> = {
  // Event types
  launch: 6,
  release: 5,
  announces: 4,
  announcing: 4,
  funding: 6,
  raises: 5,
  investment: 5,
  acquisition: 5,
  "open-source": 5,
  "open source": 5,
  opensource: 5,
  model: 4,
  models: 3,
  agent: 5,
  agents: 4,
  automation: 4,
  enterprise: 3,
  api: 3,
  regulation: 5,
  benchmark: 3,
  breakthrough: 4,
  // Companies / orgs (high salience)
  nvidia: 5,
  openai: 5,
  google: 4,
  deepmind: 4,
  anthropic: 5,
  claude: 5,
  gemini: 5,
  meta: 4,
  microsoft: 4,
  mistral: 4,
  "hugging face": 4,
  huggingface: 4,
  // Tech
  gpt: 4,
  llm: 4,
  multimodal: 3,
  "fine-tuning": 3,
  inference: 2,
  transformer: 2,
};

const RELEVANCE_RANK: Record<Relevance, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function relevanceRank(r: Relevance): number {
  return RELEVANCE_RANK[r] ?? 0;
}

export function meetsMinimumRelevance(value: Relevance, minimum: Relevance): boolean {
  return relevanceRank(value) >= relevanceRank(minimum);
}

/**
 * Compute a local relevance score from title + excerpt/content.
 * Each keyword contributes its weight once plus a small bonus for repeats.
 */
export function computeLocalScore(parts: {
  title?: string | null;
  excerpt?: string | null;
  content?: string | null;
}): number {
  const haystack = [parts.title, parts.excerpt, parts.content]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  if (!haystack) return 0;

  let score = 0;
  for (const [keyword, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    const idx = haystack.indexOf(keyword);
    if (idx === -1) continue;
    score += weight;
    // small diminishing bonus for a second mention
    const second = haystack.indexOf(keyword, idx + keyword.length);
    if (second !== -1) score += Math.ceil(weight / 2);
  }
  // Title hits matter more — re-scan the title with a multiplier.
  const title = (parts.title ?? "").toLowerCase();
  for (const [keyword, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    if (title.includes(keyword)) score += weight;
  }
  return score;
}

/** Map a local score into a coarse relevance bucket (heuristic fallback). */
export function scoreToRelevance(score: number): Relevance {
  if (score >= 24) return "CRITICAL";
  if (score >= 14) return "HIGH";
  if (score >= 6) return "MEDIUM";
  return "LOW";
}

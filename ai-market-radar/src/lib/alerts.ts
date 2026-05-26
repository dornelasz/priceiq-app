import type { Relevance } from "@prisma/client";
import { meetsMinimumRelevance, scoreToRelevance } from "./relevance";

export interface AlertCriteria {
  keyword?: string | null;
  company?: string | null;
  category?: string | null;
  minRelevance: Relevance;
}

export interface MatchableArticle {
  title: string;
  rawExcerpt?: string | null;
  localScore: number;
  analysis?: {
    relevance: Relevance;
    category: string;
    companies: string[];
    summary: string;
  } | null;
}

function includesCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Does an article satisfy an alert? All provided criteria must hold (AND).
 * Relevance uses the AI value when present, else a heuristic from localScore.
 * Pure & testable — drives the /alerts view.
 */
export function articleMatchesAlert(article: MatchableArticle, alert: AlertCriteria): boolean {
  const relevance: Relevance = article.analysis?.relevance ?? scoreToRelevance(article.localScore);
  if (!meetsMinimumRelevance(relevance, alert.minRelevance)) return false;

  const text = [article.title, article.rawExcerpt ?? "", article.analysis?.summary ?? ""].join(" ");

  if (alert.keyword?.trim()) {
    if (!includesCi(text, alert.keyword.trim())) return false;
  }

  if (alert.company?.trim()) {
    const company = alert.company.trim();
    const inList = (article.analysis?.companies ?? []).some((c) => includesCi(c, company));
    if (!inList && !includesCi(text, company)) return false;
  }

  if (alert.category?.trim()) {
    if (article.analysis?.category !== alert.category.trim()) return false;
  }

  return true;
}

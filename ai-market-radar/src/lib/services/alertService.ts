import type { Alert } from "@prisma/client";
import { articleMatchesAlert, type MatchableArticle } from "../alerts";
import { prisma } from "../prisma";

export interface AlertMatch {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: Date | null;
  relevance: string | null;
  category: string | null;
}

/**
 * Find recent articles that satisfy an alert's criteria. Pulls a bounded
 * recent window from the DB and filters in-process with the pure matcher.
 */
export async function findMatchesForAlert(alert: Alert, limit = 20): Promise<AlertMatch[]> {
  const rows = await prisma.article.findMany({
    orderBy: { collectedAt: "desc" },
    take: 300,
    include: { analysis: true, source: { select: { name: true } } },
  });

  const matches: AlertMatch[] = [];
  for (const a of rows) {
    const candidate: MatchableArticle = {
      title: a.title,
      rawExcerpt: a.rawExcerpt,
      localScore: a.localScore,
      analysis: a.analysis
        ? {
            relevance: a.analysis.relevance,
            category: a.analysis.category,
            companies: a.analysis.companies,
            summary: a.analysis.summary,
          }
        : null,
    };
    if (
      articleMatchesAlert(candidate, {
        keyword: alert.keyword,
        company: alert.company,
        category: alert.category,
        minRelevance: alert.minRelevance,
      })
    ) {
      matches.push({
        id: a.id,
        title: a.title,
        url: a.url,
        sourceName: a.source.name,
        publishedAt: a.publishedAt,
        relevance: a.analysis?.relevance ?? null,
        category: a.analysis?.category ?? null,
      });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

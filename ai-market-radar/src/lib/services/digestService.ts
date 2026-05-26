import { buildDigest, type DigestArticle, type DigestData } from "../digest";
import { prisma } from "../prisma";

function dayBounds(date: Date): { start: Date; end: Date; key: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const key = start.toISOString().slice(0, 10);
  return { start, end, key };
}

/**
 * Generate (and persist) the daily digest from articles collected that day.
 * Uses ONLY real stored articles — never fabricates entries.
 */
export async function generateDigest(date: Date = new Date()): Promise<DigestData> {
  const { start, end, key } = dayBounds(date);

  const rows = await prisma.article.findMany({
    where: { collectedAt: { gte: start, lt: end } },
    orderBy: { collectedAt: "desc" },
    take: 500,
    include: { analysis: true, source: { select: { name: true } } },
  });

  const articles: DigestArticle[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    canonicalUrl: a.canonicalUrl,
    publishedAt: a.publishedAt,
    localScore: a.localScore,
    sourceName: a.source.name,
    analysis: a.analysis
      ? {
          relevance: a.analysis.relevance,
          articleType: a.analysis.articleType,
          category: a.analysis.category,
          companies: a.analysis.companies,
          technologies: a.analysis.technologies,
          keywords: a.analysis.keywords,
          summary: a.analysis.summary,
          impact: a.analysis.impact,
        }
      : null,
  }));

  const data = buildDigest(articles, key);

  await prisma.dailyDigest.upsert({
    where: { date: start },
    create: {
      date: start,
      title: data.title,
      summary: data.summary,
      topArticles: data.topArticles,
      trends: data.trends,
      companies: data.companies,
    },
    update: {
      title: data.title,
      summary: data.summary,
      topArticles: data.topArticles,
      trends: data.trends,
      companies: data.companies,
    },
  });

  return data;
}

/** Today's digest, always recomputed live so it reflects the latest articles. */
export async function getTodayDigest(): Promise<DigestData> {
  return generateDigest(new Date());
}

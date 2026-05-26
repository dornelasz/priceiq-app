import type { ArticleType, Relevance } from "@prisma/client";
import { relevanceRank, scoreToRelevance } from "./relevance";

export interface DigestArticleAnalysis {
  relevance: Relevance;
  articleType: ArticleType;
  category: string;
  companies: string[];
  technologies: string[];
  keywords: string[];
  summary: string;
  impact: string;
}

export interface DigestArticle {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  publishedAt: Date | null;
  localScore: number;
  sourceName: string;
  analysis: DigestArticleAnalysis | null;
}

export interface DigestData {
  date: string;
  title: string;
  summary: string;
  totalArticles: number;
  topArticles: Array<{
    id: string;
    title: string;
    url: string;
    sourceName: string;
    relevance: Relevance;
    category: string | null;
    summary: string | null;
  }>;
  trends: Array<{ term: string; count: number }>;
  companies: Array<{ name: string; count: number }>;
  newTools: Array<{ id: string; title: string; url: string; sourceName: string }>;
  businessImpacts: Array<{ id: string; title: string; impact: string }>;
}

function effectiveRelevance(a: DigestArticle): Relevance {
  return a.analysis?.relevance ?? scoreToRelevance(a.localScore);
}

function tally(values: string[]): Array<{ term: string; count: number }> {
  const counts = new Map<string, { term: string; count: number }>();
  for (const raw of values) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { term, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Build the daily digest from articles ALREADY collected that day.
 * Pure & deterministic — invents nothing; only aggregates real data.
 */
export function buildDigest(articles: DigestArticle[], date: string): DigestData {
  const sorted = [...articles].sort((a, b) => {
    const r = relevanceRank(effectiveRelevance(b)) - relevanceRank(effectiveRelevance(a));
    if (r !== 0) return r;
    if (b.localScore !== a.localScore) return b.localScore - a.localScore;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });

  const topArticles = sorted.slice(0, 5).map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    sourceName: a.sourceName,
    relevance: effectiveRelevance(a),
    category: a.analysis?.category ?? null,
    summary: a.analysis?.summary ?? null,
  }));

  const trends = tally(
    articles.flatMap((a) => [...(a.analysis?.keywords ?? []), ...(a.analysis?.technologies ?? [])]),
  ).slice(0, 8);

  const companies = tally(articles.flatMap((a) => a.analysis?.companies ?? []))
    .slice(0, 8)
    .map((c) => ({ name: c.term, count: c.count }));

  const newTools = sorted
    .filter((a) => a.analysis?.articleType === "TOOL")
    .slice(0, 8)
    .map((a) => ({ id: a.id, title: a.title, url: a.url, sourceName: a.sourceName }));

  const businessImpacts = sorted
    .filter((a) => a.analysis?.impact)
    .sort((a, b) => {
      const aBiz = a.analysis?.category === "IA para negócios" ? 1 : 0;
      const bBiz = b.analysis?.category === "IA para negócios" ? 1 : 0;
      return bBiz - aBiz;
    })
    .slice(0, 5)
    .map((a) => ({ id: a.id, title: a.title, impact: a.analysis!.impact }));

  const total = articles.length;
  const summaryParts: string[] = [`${total} notícia(s) coletada(s) em ${date}.`];
  if (topArticles.length) {
    summaryParts.push(`Destaques: ${topArticles.map((t) => t.title).join("; ")}.`);
  }
  if (companies.length) {
    summaryParts.push(`Empresas mais citadas: ${companies.map((c) => c.name).join(", ")}.`);
  }
  if (newTools.length) {
    summaryParts.push(`${newTools.length} nova(s) ferramenta(s) detectada(s).`);
  }

  return {
    date,
    title: `Resumo Diário — ${date}`,
    summary: summaryParts.join(" "),
    totalArticles: total,
    topArticles,
    trends,
    companies,
    newTools,
    businessImpacts,
  };
}

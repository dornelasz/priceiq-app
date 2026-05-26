import type { Source } from "@prisma/client";
import { analyzeArticle, type AnalysisResult } from "../ai/analyze";
import { isAiConfigured } from "../ai/gemini";
import { errorMessage, runIsolated } from "../async";
import { collectSource } from "../collectors";
import type { ExistingArticleRef } from "../dedup";
import { env } from "../env";
import { planIngest } from "../ingest";
import { prisma } from "../prisma";
import { canonicalizeUrl } from "../url";

export interface SourceRunSummary {
  sourceId: string;
  sourceName: string;
  status: "SUCCESS" | "PARTIAL" | "ERROR";
  found: number;
  created: number;
  analyzed: number;
  duplicates: number;
  warnings: string[];
  error?: string;
}

export interface RunSummary {
  sources: number;
  found: number;
  created: number;
  analyzed: number;
  duplicates: number;
  failures: number;
  results: SourceRunSummary[];
}

const REF_SELECT = {
  canonicalUrl: true,
  contentHash: true,
  title: true,
  sourceId: true,
  publishedAt: true,
} as const;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

async function persistAnalysis(articleId: string, analysis: AnalysisResult): Promise<void> {
  await prisma.$transaction([
    prisma.articleAnalysis.upsert({
      where: { articleId },
      create: { articleId, ...analysis },
      update: { ...analysis },
    }),
    prisma.article.update({ where: { id: articleId }, data: { status: "ANALYZED" } }),
  ]);
}

/**
 * Collect + dedupe + (optionally) analyze a single source.
 * NEVER throws — failures are recorded on the source and FetchLog, so the
 * caller's loop keeps processing the remaining sources (rules 5 & 7).
 */
export async function runForSource(source: Source): Promise<SourceRunSummary> {
  const log = await prisma.fetchLog.create({
    data: { sourceId: source.id, status: "RUNNING" },
  });
  const summary: SourceRunSummary = {
    sourceId: source.id,
    sourceName: source.name,
    status: "SUCCESS",
    found: 0,
    created: 0,
    analyzed: 0,
    duplicates: 0,
    warnings: [],
  };

  try {
    const result = await collectSource({ url: source.url, name: source.name, type: source.type });
    summary.warnings = result.warnings;
    summary.found = result.items.length;

    const candidateUrls = result.items
      .map((i) => canonicalizeUrl(i.url))
      .filter((u): u is string => Boolean(u));

    const [byUrl, recentSameSource] = await Promise.all([
      candidateUrls.length
        ? prisma.article.findMany({ where: { canonicalUrl: { in: candidateUrls } }, select: REF_SELECT })
        : Promise.resolve([] as ExistingArticleRef[]),
      prisma.article.findMany({
        where: { sourceId: source.id },
        orderBy: { collectedAt: "desc" },
        take: 120,
        select: REF_SELECT,
      }),
    ]);

    const seen = new Set<string>();
    const existing: ExistingArticleRef[] = [];
    for (const ref of [...byUrl, ...recentSameSource]) {
      if (seen.has(ref.canonicalUrl)) continue;
      seen.add(ref.canonicalUrl);
      existing.push(ref);
    }

    const plan = planIngest(result.items, source.id, existing);
    summary.duplicates = plan.duplicates.length;

    const created = [] as Array<{
      id: string;
      title: string;
      url: string;
      rawExcerpt: string | null;
      rawContent: string | null;
    }>;
    for (const input of plan.toCreate) {
      try {
        const article = await prisma.article.create({
          data: { ...input, status: "PENDING_ANALYSIS" },
          select: { id: true, title: true, url: true, rawExcerpt: true, rawContent: true },
        });
        created.push(article);
      } catch (error) {
        if (isUniqueViolation(error)) {
          summary.duplicates += 1;
          continue;
        }
        throw error;
      }
    }
    summary.created = created.length;

    // Optional AI analysis (only if a key is configured). Isolated per-article.
    if (env.analyzeOnFetch && isAiConfigured() && created.length > 0) {
      const toAnalyze = created.slice(0, env.maxAnalyzePerRun);
      const { results } = await runIsolated(toAnalyze, async (article) => {
        const analysis = await analyzeArticle({
          title: article.title,
          url: article.url,
          excerpt: article.rawExcerpt,
          content: article.rawContent,
        });
        if (!analysis) return false;
        await persistAnalysis(article.id, analysis);
        return true;
      });
      summary.analyzed = results.filter(Boolean).length;
    }

    summary.status = summary.warnings.length > 0 ? "PARTIAL" : "SUCCESS";
    await prisma.source.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: new Date(),
        lastError: summary.warnings.length ? summary.warnings.join(" | ") : null,
      },
    });
    await prisma.fetchLog.update({
      where: { id: log.id },
      data: {
        status: summary.status,
        finishedAt: new Date(),
        articlesFound: summary.found,
        articlesCreated: summary.created,
        message: `coletadas=${summary.found} novas=${summary.created} dups=${summary.duplicates} analisadas=${summary.analyzed}`,
      },
    });
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    summary.status = "ERROR";
    summary.error = message;
    await prisma.source
      .update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastError: message } })
      .catch(() => undefined);
    await prisma.fetchLog
      .update({
        where: { id: log.id },
        data: {
          status: "ERROR",
          finishedAt: new Date(),
          message,
          articlesFound: summary.found,
          articlesCreated: summary.created,
        },
      })
      .catch(() => undefined);
    return summary;
  }
}

export async function runForSourceId(sourceId: string): Promise<SourceRunSummary> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) {
    return {
      sourceId,
      sourceName: "(desconhecida)",
      status: "ERROR",
      found: 0,
      created: 0,
      analyzed: 0,
      duplicates: 0,
      warnings: [],
      error: "Fonte não encontrada.",
    };
  }
  return runForSource(source);
}

function aggregate(results: SourceRunSummary[]): RunSummary {
  return {
    sources: results.length,
    found: results.reduce((n, r) => n + r.found, 0),
    created: results.reduce((n, r) => n + r.created, 0),
    analyzed: results.reduce((n, r) => n + r.analyzed, 0),
    duplicates: results.reduce((n, r) => n + r.duplicates, 0),
    failures: results.filter((r) => r.status === "ERROR").length,
    results,
  };
}

/** Run only sources that are active AND due (respecting fetchIntervalMinutes). */
export async function runDueSources(): Promise<RunSummary> {
  const sources = await prisma.source.findMany({ where: { isActive: true } });
  const now = Date.now();
  const due = sources.filter(
    (s) =>
      !s.lastFetchedAt || now - s.lastFetchedAt.getTime() >= s.fetchIntervalMinutes * 60_000,
  );
  const { results } = await runIsolated(due, runForSource);
  return aggregate(results);
}

/** Run every active source regardless of schedule (manual "Coletar agora"). */
export async function runAllActive(): Promise<RunSummary> {
  const sources = await prisma.source.findMany({ where: { isActive: true } });
  const { results } = await runIsolated(sources, runForSource);
  return aggregate(results);
}

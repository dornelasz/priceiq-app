import { isAiConfigured } from "@/lib/ai/gemini";
import { env } from "@/lib/env";
import { json, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => {
    const [sourcesTotal, sourcesActive, articlesTotal, analyzed, pending, lastFetch] =
      await Promise.all([
        prisma.source.count(),
        prisma.source.count({ where: { isActive: true } }),
        prisma.article.count(),
        prisma.article.count({ where: { status: "ANALYZED" } }),
        prisma.article.count({ where: { status: "PENDING_ANALYSIS" } }),
        prisma.fetchLog.findFirst({
          orderBy: { startedAt: "desc" },
          include: { source: { select: { name: true } } },
        }),
      ]);

    return json({
      ai: { configured: isAiConfigured(), model: env.geminiModel },
      sources: { total: sourcesTotal, active: sourcesActive },
      articles: { total: articlesTotal, analyzed, pending },
      lastFetch: lastFetch
        ? {
            at: lastFetch.startedAt,
            status: lastFetch.status,
            source: lastFetch.source.name,
            message: lastFetch.message,
          }
        : null,
      schedule: {
        fetchCron: env.workerFetchCron,
        digestCron: env.workerDigestCron,
        timezone: env.timezone,
        defaultFetchIntervalMinutes: env.defaultFetchIntervalMinutes,
        analyzeOnFetch: env.analyzeOnFetch,
      },
      appName: env.appName,
    });
  });
}

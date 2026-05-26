import { type NextRequest } from "next/server";
import { analyzeArticle } from "@/lib/ai/analyze";
import { isAiConfigured } from "@/lib/ai/gemini";
import { json, notFound, route, serviceUnavailable } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// On-demand AI analysis for a single article. Returns 503 (not an error) when
// no Gemini key is configured — the article simply stays "pending analysis".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    if (!isAiConfigured()) {
      return serviceUnavailable(
        "IA não configurada (GEMINI_API_KEY ausente). A notícia permanece pendente de análise.",
      );
    }

    const article = await prisma.article.findUnique({ where: { id: params.id } });
    if (!article) return notFound("Notícia não encontrada.");

    const analysis = await analyzeArticle({
      title: article.title,
      url: article.url,
      excerpt: article.rawExcerpt,
      content: article.rawContent,
    });
    if (!analysis) {
      return serviceUnavailable("IA não retornou análise.");
    }

    const saved = await prisma.articleAnalysis.upsert({
      where: { articleId: article.id },
      create: { articleId: article.id, ...analysis },
      update: { ...analysis },
    });
    await prisma.article.update({ where: { id: article.id }, data: { status: "ANALYZED" } });

    return json({ status: "ANALYZED", analysis: saved });
  });
}

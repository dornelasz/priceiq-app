import { type NextRequest } from "next/server";
import { json, notFound, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const article = await prisma.article.findUnique({
      where: { id: params.id },
      include: {
        source: { select: { id: true, name: true, type: true, url: true } },
        analysis: true,
      },
    });
    if (!article) return notFound("Notícia não encontrada.");
    return json(article);
  });
}

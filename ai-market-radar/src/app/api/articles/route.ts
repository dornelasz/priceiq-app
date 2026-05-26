import { type NextRequest } from "next/server";
import { buildArticleWhere } from "@/lib/articleQuery";
import { json, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { clampInt } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return route(async () => {
    const params = req.nextUrl.searchParams;
    const page = clampInt(params.get("page"), 1, 1, 100000);
    const pageSize = clampInt(params.get("pageSize"), 20, 1, 100);
    const where = buildArticleWhere(params);

    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: [{ localScore: "desc" }, { collectedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          source: { select: { id: true, name: true, type: true } },
          analysis: true,
        },
      }),
      prisma.article.count({ where }),
    ]);

    return json({
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
  });
}

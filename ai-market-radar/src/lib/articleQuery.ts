import type { Prisma } from "@prisma/client";
import { relevanceAtLeast } from "./validation";

/** Build a Prisma `where` for the article list from URL query params. */
export function buildArticleWhere(params: URLSearchParams): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = {};
  const and: Prisma.ArticleWhereInput[] = [];

  const q = params.get("q")?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { rawExcerpt: { contains: q, mode: "insensitive" } },
        { analysis: { summary: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const category = params.get("category")?.trim();
  if (category) and.push({ analysis: { category } });

  const type = params.get("type")?.trim();
  if (type) and.push({ analysis: { articleType: type as never } });

  const minRelevance = params.get("relevance")?.trim();
  if (minRelevance) {
    const levels = relevanceAtLeast(minRelevance);
    if (levels) and.push({ analysis: { relevance: { in: levels } } });
  }

  const sourceId = params.get("sourceId")?.trim();
  if (sourceId) where.sourceId = sourceId;

  const status = params.get("status")?.trim();
  if (status) where.status = status as never;

  const company = params.get("company")?.trim();
  if (company) and.push({ analysis: { companies: { has: company } } });

  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  if (from || to) {
    const collectedAt: Prisma.DateTimeFilter = {};
    if (from && !Number.isNaN(Date.parse(from))) collectedAt.gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) collectedAt.lte = new Date(`${to}T23:59:59`);
    where.collectedAt = collectedAt;
  }

  if (and.length) where.AND = and;
  return where;
}

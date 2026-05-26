import { type NextRequest } from "next/server";
import { badRequest, json, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { findMatchesForAlert } from "@/lib/services/alertService";
import { isRelevance } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return route(async () => {
    const withMatches = req.nextUrl.searchParams.get("withMatches") === "1";
    const alerts = await prisma.alert.findMany({ orderBy: { createdAt: "desc" } });

    if (!withMatches) return json({ items: alerts });

    const items = await Promise.all(
      alerts.map(async (alert) => ({
        ...alert,
        matches: alert.isActive ? await findMatchesForAlert(alert, 10) : [],
      })),
    );
    return json({ items });
  });
}

export async function POST(req: NextRequest) {
  return route(async () => {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("Campo 'name' é obrigatório.");
    if (body.minRelevance !== undefined && !isRelevance(body.minRelevance)) {
      return badRequest("Campo 'minRelevance' inválido.");
    }

    const alert = await prisma.alert.create({
      data: {
        name,
        keyword: body.keyword ? String(body.keyword).trim() : null,
        company: body.company ? String(body.company).trim() : null,
        category: body.category ? String(body.category).trim() : null,
        minRelevance: isRelevance(body.minRelevance) ? body.minRelevance : "LOW",
        isActive: typeof body.isActive === "boolean" ? body.isActive : true,
        userId: typeof body.userId === "string" ? body.userId : null,
      },
    });
    return json(alert, 201);
  });
}

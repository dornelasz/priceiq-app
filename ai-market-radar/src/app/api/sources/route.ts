import { type NextRequest } from "next/server";
import { normalizeCategory } from "@/lib/categories";
import { env } from "@/lib/env";
import { badRequest, conflict, json, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { clampInt, isSourceType, isValidUrl } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => {
    const sources = await prisma.source.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { articles: true } } },
    });
    return json({ items: sources });
  });
}

export async function POST(req: NextRequest) {
  return route(async () => {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!name) return badRequest("Campo 'name' é obrigatório.");
    if (!isValidUrl(url)) return badRequest("Campo 'url' deve ser uma URL http(s) válida.");
    if (body.type !== undefined && !isSourceType(body.type)) {
      return badRequest("Campo 'type' inválido.");
    }

    const data = {
      name,
      url,
      type: isSourceType(body.type) ? body.type : ("RSS" as const),
      category: body.category ? normalizeCategory(String(body.category)) : null,
      isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      fetchIntervalMinutes: clampInt(
        body.fetchIntervalMinutes,
        env.defaultFetchIntervalMinutes,
        5,
        60 * 24,
      ),
    };

    try {
      const source = await prisma.source.create({ data });
      return json(source, 201);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return conflict("Já existe uma fonte com essa URL.");
      }
      throw error;
    }
  });
}

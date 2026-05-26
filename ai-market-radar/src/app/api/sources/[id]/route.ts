import type { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { normalizeCategory } from "@/lib/categories";
import { badRequest, conflict, json, notFound, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { clampInt, isSourceType, isValidUrl } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const existing = await prisma.source.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("Fonte não encontrada.");

    const body = await readJson(req);
    const data: Prisma.SourceUpdateInput = {};

    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body.url !== undefined) {
      if (!isValidUrl(body.url)) return badRequest("Campo 'url' deve ser uma URL http(s) válida.");
      data.url = String(body.url).trim();
    }
    if (body.type !== undefined) {
      if (!isSourceType(body.type)) return badRequest("Campo 'type' inválido.");
      data.type = body.type;
    }
    if (body.category !== undefined) {
      data.category = body.category ? normalizeCategory(String(body.category)) : null;
    }
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (body.fetchIntervalMinutes !== undefined) {
      data.fetchIntervalMinutes = clampInt(
        body.fetchIntervalMinutes,
        existing.fetchIntervalMinutes,
        5,
        60 * 24,
      );
    }

    try {
      const updated = await prisma.source.update({ where: { id: params.id }, data });
      return json(updated);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return conflict("Já existe uma fonte com essa URL.");
      }
      throw error;
    }
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const existing = await prisma.source.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("Fonte não encontrada.");
    await prisma.source.delete({ where: { id: params.id } });
    return json({ deleted: true, id: params.id });
  });
}

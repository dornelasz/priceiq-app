import type { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { badRequest, json, notFound, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isRelevance } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const existing = await prisma.alert.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("Alerta não encontrado.");

    const body = await readJson(req);
    const data: Prisma.AlertUpdateInput = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body.keyword !== undefined) data.keyword = body.keyword ? String(body.keyword).trim() : null;
    if (body.company !== undefined) data.company = body.company ? String(body.company).trim() : null;
    if (body.category !== undefined)
      data.category = body.category ? String(body.category).trim() : null;
    if (body.minRelevance !== undefined) {
      if (!isRelevance(body.minRelevance)) return badRequest("Campo 'minRelevance' inválido.");
      data.minRelevance = body.minRelevance;
    }
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    const updated = await prisma.alert.update({ where: { id: params.id }, data });
    return json(updated);
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const existing = await prisma.alert.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("Alerta não encontrado.");
    await prisma.alert.delete({ where: { id: params.id } });
    return json({ deleted: true, id: params.id });
  });
}

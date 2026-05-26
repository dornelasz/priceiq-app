import { type NextRequest } from "next/server";
import { badRequest, json, readJson, route } from "@/lib/http";
import { generateDigest } from "@/lib/services/digestService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return route(async () => {
    const body = await readJson<{ date?: string }>(req);
    let date = new Date();
    if (body.date) {
      const parsed = new Date(body.date);
      if (Number.isNaN(parsed.getTime())) return badRequest("Campo 'date' inválido.");
      date = parsed;
    }
    const digest = await generateDigest(date);
    return json(digest);
  });
}

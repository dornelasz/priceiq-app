import { type NextRequest } from "next/server";
import { json, route } from "@/lib/http";
import { runForSourceId } from "@/lib/services/fetchRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const summary = await runForSourceId(params.id);
    const status = summary.status === "ERROR" ? 502 : 200;
    return json(summary, status);
  });
}

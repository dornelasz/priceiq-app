import { json, route } from "@/lib/http";
import { runAllActive } from "@/lib/services/fetchRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Manual "Coletar agora" — runs every active source regardless of schedule.
export async function POST() {
  return route(async () => {
    const summary = await runAllActive();
    return json(summary);
  });
}

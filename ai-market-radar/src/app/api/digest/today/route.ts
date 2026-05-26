import { json, route } from "@/lib/http";
import { getTodayDigest } from "@/lib/services/digestService";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => {
    const digest = await getTodayDigest();
    return json(digest);
  });
}

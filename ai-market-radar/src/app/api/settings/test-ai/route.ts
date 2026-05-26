import { testConnection } from "@/lib/ai/gemini";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  return route(async () => {
    const result = await testConnection();
    return json(result, result.ok ? 200 : result.configured ? 502 : 200);
  });
}

"use client";

import { useState } from "react";
import { IconCheck, IconAlert, IconSpark } from "@/components/Icons";
import { Spinner } from "@/components/ui";

export function TestAiButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-ai", { method: "POST" });
      const data = await res.json();
      setResult({ ok: Boolean(data.ok), message: data.message ?? "" });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Erro" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={run} disabled={loading} className="btn-primary w-fit">
        {loading ? <Spinner /> : <IconSpark width={16} height={16} />}
        Testar Gemini API
      </button>
      {result ? (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          {result.ok ? <IconCheck width={16} height={16} /> : <IconAlert width={16} height={16} />}
          <span>{result.message}</span>
        </div>
      ) : null}
    </div>
  );
}

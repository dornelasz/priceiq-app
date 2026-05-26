"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSpark } from "@/components/Icons";
import { Spinner } from "@/components/ui";

export function AnalyzeButton({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/analyze/${articleId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha na análise");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button onClick={run} disabled={loading} className="btn-primary w-fit">
        {loading ? <Spinner /> : <IconSpark width={16} height={16} />}
        Analisar com IA
      </button>
      {error ? <span className="text-xs text-relevance-critical">{error}</span> : null}
    </div>
  );
}

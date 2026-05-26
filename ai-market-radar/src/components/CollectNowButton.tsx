"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@/components/Icons";
import { Spinner } from "@/components/ui";

export function CollectNowButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/fetch/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha na coleta");
      setMsg(
        `${data.created} nova(s) · ${data.analyzed} analisada(s) · ${data.failures} falha(s)`,
      );
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro na coleta");
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && !compact ? <span className="hidden text-xs text-zinc-400 sm:inline">{msg}</span> : null}
      <button onClick={run} disabled={loading} className="btn-primary">
        {loading ? <Spinner /> : <IconRefresh width={16} height={16} />}
        {compact ? "Coletar" : "Coletar agora"}
      </button>
    </div>
  );
}

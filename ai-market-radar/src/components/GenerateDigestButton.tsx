"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@/components/Icons";
import { Spinner } from "@/components/ui";

export function GenerateDigestButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      await fetch("/api/digest/generate", { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn-ghost">
      {loading ? <Spinner /> : <IconRefresh width={15} height={15} />}
      Regenerar
    </button>
  );
}

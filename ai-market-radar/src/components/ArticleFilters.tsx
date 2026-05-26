"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ARTICLE_TYPE_LABEL, RELEVANCE_LABEL } from "@/lib/format";
import { ARTICLE_TYPES, RELEVANCE_LEVELS } from "@/lib/validation";

export function ArticleFilters({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`/articles?${next.toString()}`);
  }

  const select = "input appearance-none";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <select
        className={select}
        value={params.get("relevance") ?? ""}
        onChange={(e) => update("relevance", e.target.value)}
        aria-label="Relevância mínima"
      >
        <option value="">Relevância: todas</option>
        {RELEVANCE_LEVELS.map((r) => (
          <option key={r} value={r}>
            Mín.: {RELEVANCE_LABEL[r]}
          </option>
        ))}
      </select>

      <select
        className={select}
        value={params.get("type") ?? ""}
        onChange={(e) => update("type", e.target.value)}
        aria-label="Tipo"
      >
        <option value="">Tipo: todos</option>
        {ARTICLE_TYPES.map((t) => (
          <option key={t} value={t}>
            {ARTICLE_TYPE_LABEL[t]}
          </option>
        ))}
      </select>

      <select
        className={select}
        value={params.get("sourceId") ?? ""}
        onChange={(e) => update("sourceId", e.target.value)}
        aria-label="Fonte"
      >
        <option value="">Fonte: todas</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <input
        type="date"
        className={select}
        value={params.get("from") ?? ""}
        onChange={(e) => update("from", e.target.value)}
        aria-label="De"
      />
      <input
        type="date"
        className={select}
        value={params.get("to") ?? ""}
        onChange={(e) => update("to", e.target.value)}
        aria-label="Até"
      />
    </div>
  );
}

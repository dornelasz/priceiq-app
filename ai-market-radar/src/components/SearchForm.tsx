"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function SearchForm({
  basePath,
  placeholder = "Buscar por palavra-chave…",
}: {
  basePath: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    next.delete("page");
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <form onSubmit={submit} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input pr-20"
        aria-label="Buscar"
      />
      <button type="submit" className="absolute right-1.5 top-1.5 btn-ghost px-2.5 py-1 text-xs">
        Buscar
      </button>
    </form>
  );
}

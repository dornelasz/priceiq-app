"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceType } from "@prisma/client";
import { CATEGORIES } from "@/lib/categories";
import { SOURCE_TYPE_LABEL, hostOf, timeAgo } from "@/lib/format";
import { SOURCE_TYPES } from "@/lib/validation";
import { Pill, Spinner } from "@/components/ui";
import { IconExternal, IconRefresh } from "@/components/Icons";

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  type: SourceType;
  category: string | null;
  isActive: boolean;
  fetchIntervalMinutes: number;
  lastFetchedAt: string | Date | null;
  lastError: string | null;
  _count?: { articles: number };
}

const EMPTY = {
  name: "",
  url: "",
  type: "RSS" as SourceType,
  category: "",
  fetchIntervalMinutes: 60,
  isActive: true,
};

export function SourceManager({ initialSources }: { initialSources: SourceRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setForm({ ...EMPTY });
    setEditingId(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      const payload = {
        name: form.name,
        url: form.url,
        type: form.type,
        category: form.category || null,
        fetchIntervalMinutes: Number(form.fetchIntervalMinutes) || 60,
        isActive: form.isActive,
      };
      const res = await fetch(editingId ? `/api/sources/${editingId}` : "/api/sources", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha ao salvar");
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(null);
    }
  }

  async function action(id: string, kind: "fetch" | "toggle" | "delete", source?: SourceRow) {
    setBusy(`${kind}:${id}`);
    setError(null);
    try {
      if (kind === "fetch") {
        const res = await fetch(`/api/sources/${id}/fetch`, { method: "POST" });
        const data = await res.json();
        if (!res.ok && data?.status !== "ERROR") throw new Error(data?.error ?? "Falha");
      } else if (kind === "toggle" && source) {
        const res = await fetch(`/api/sources/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !source.isActive }),
        });
        if (!res.ok) throw new Error("Falha ao atualizar");
      } else if (kind === "delete") {
        if (!confirm("Excluir esta fonte e suas notícias coletadas?")) return;
        const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Falha ao excluir");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(null);
    }
  }

  function startEdit(s: SourceRow) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      url: s.url,
      type: s.type,
      category: s.category ?? "",
      fetchIntervalMinutes: s.fetchIntervalMinutes,
      isActive: s.isActive,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card space-y-3 p-4">
        <p className="text-sm font-semibold text-zinc-200">
          {editingId ? "Editar fonte" : "Nova fonte"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="OpenAI Blog"
              required
            />
          </div>
          <div>
            <label className="label">URL (feed RSS / página pública)</label>
            <input
              className="input"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://exemplo.com/feed.xml"
              required
            />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as SourceType })}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SOURCE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Categoria principal</label>
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">—</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Frequência de coleta (min)</label>
            <input
              type="number"
              min={5}
              className="input"
              value={form.fetchIntervalMinutes}
              onChange={(e) =>
                setForm({ ...form, fetchIntervalMinutes: Number(e.target.value) })
              }
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            Fonte ativa
          </label>
        </div>
        {error ? <p className="text-xs text-relevance-critical">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy === "form"} className="btn-primary">
            {busy === "form" ? <Spinner /> : null}
            {editingId ? "Salvar alterações" : "Adicionar fonte"}
          </button>
          {editingId ? (
            <button type="button" onClick={reset} className="btn-ghost">
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      <div className="space-y-3">
        {initialSources.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{s.name}</span>
                  <Pill>{SOURCE_TYPE_LABEL[s.type]}</Pill>
                  {s.category ? <Pill className="text-zinc-400">{s.category}</Pill> : null}
                  {s.isActive ? (
                    <Pill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      Ativa
                    </Pill>
                  ) : (
                    <Pill className="text-zinc-500">Inativa</Pill>
                  )}
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-soft"
                >
                  {hostOf(s.url)} <IconExternal width={12} height={12} />
                </a>
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-500">
                  <span>a cada {s.fetchIntervalMinutes} min</span>
                  <span>última coleta: {s.lastFetchedAt ? timeAgo(s.lastFetchedAt) : "nunca"}</span>
                  <span>{s._count?.articles ?? 0} notícia(s)</span>
                </div>
                {s.lastError ? (
                  <p className="mt-1 line-clamp-2 text-xs text-relevance-critical">
                    Último erro: {s.lastError}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => action(s.id, "fetch")}
                  disabled={busy === `fetch:${s.id}`}
                  className="btn-ghost"
                  title="Coletar agora"
                >
                  {busy === `fetch:${s.id}` ? <Spinner /> : <IconRefresh width={15} height={15} />}
                  Coletar
                </button>
                <button onClick={() => startEdit(s)} className="btn-ghost">
                  Editar
                </button>
                <button onClick={() => action(s.id, "toggle", s)} className="btn-ghost">
                  {s.isActive ? "Desativar" : "Ativar"}
                </button>
                <button onClick={() => action(s.id, "delete")} className="btn-danger">
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

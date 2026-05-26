"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Relevance } from "@prisma/client";
import { CATEGORIES } from "@/lib/categories";
import { RELEVANCE_LABEL, timeAgo } from "@/lib/format";
import { RELEVANCE_LEVELS } from "@/lib/validation";
import { EmptyState, Pill, Spinner } from "@/components/ui";
import { IconBell } from "@/components/Icons";

export interface AlertMatch {
  id: string;
  title: string;
  sourceName: string;
  publishedAt: string | Date | null;
  relevance: string | null;
}

export interface AlertWithMatches {
  id: string;
  name: string;
  keyword: string | null;
  company: string | null;
  category: string | null;
  minRelevance: Relevance;
  isActive: boolean;
  matches: AlertMatch[];
}

const EMPTY = {
  name: "",
  keyword: "",
  company: "",
  category: "",
  minRelevance: "LOW" as Relevance,
  isActive: true,
};

export function AlertManager({ initialAlerts }: { initialAlerts: AlertWithMatches[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setForm({ ...EMPTY });
    setEditingId(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      const payload = {
        name: form.name,
        keyword: form.keyword || null,
        company: form.company || null,
        category: form.category || null,
        minRelevance: form.minRelevance,
        isActive: form.isActive,
      };
      const res = await fetch(editingId ? `/api/alerts/${editingId}` : "/api/alerts", {
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

  async function toggle(a: AlertWithMatches) {
    setBusy(`toggle:${a.id}`);
    await fetch(`/api/alerts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !a.isActive }),
    });
    setBusy(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Excluir este alerta?")) return;
    setBusy(`del:${id}`);
    await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  function startEdit(a: AlertWithMatches) {
    setEditingId(a.id);
    setForm({
      name: a.name,
      keyword: a.keyword ?? "",
      company: a.company ?? "",
      category: a.category ?? "",
      minRelevance: a.minRelevance,
      isActive: a.isActive,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card space-y-3 p-4">
        <p className="text-sm font-semibold text-zinc-200">
          {editingId ? "Editar alerta" : "Novo alerta"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nome do alerta</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Lançamentos OpenAI"
              required
            />
          </div>
          <div>
            <label className="label">Palavra-chave</label>
            <input
              className="input"
              value={form.keyword}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              placeholder="Ex.: Gemini, Claude, agentes"
            />
          </div>
          <div>
            <label className="label">Empresa</label>
            <input
              className="input"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              placeholder="Ex.: OpenAI"
            />
          </div>
          <div>
            <label className="label">Categoria</label>
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">Qualquer</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Relevância mínima</label>
            <select
              className="input"
              value={form.minRelevance}
              onChange={(e) => setForm({ ...form, minRelevance: e.target.value as Relevance })}
            >
              {RELEVANCE_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {RELEVANCE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            Alerta ativo
          </label>
        </div>
        {error ? <p className="text-xs text-relevance-critical">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy === "form"} className="btn-primary">
            {busy === "form" ? <Spinner /> : null}
            {editingId ? "Salvar" : "Criar alerta"}
          </button>
          {editingId ? (
            <button type="button" onClick={reset} className="btn-ghost">
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      {initialAlerts.length === 0 ? (
        <EmptyState
          icon={<IconBell width={36} height={36} />}
          title="Nenhum alerta ainda"
          description="Crie alertas por palavra-chave, empresa ou categoria. As correspondências aparecem aqui (estrutura pronta para notificar por e-mail futuramente)."
        />
      ) : (
        <div className="space-y-3">
          {initialAlerts.map((a) => (
            <div key={a.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-100">{a.name}</span>
                    {a.isActive ? (
                      <Pill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        Ativo
                      </Pill>
                    ) : (
                      <Pill className="text-zinc-500">Inativo</Pill>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {a.keyword ? <Pill>palavra: {a.keyword}</Pill> : null}
                    {a.company ? <Pill>empresa: {a.company}</Pill> : null}
                    {a.category ? <Pill>categoria: {a.category}</Pill> : null}
                    <Pill>relevância ≥ {RELEVANCE_LABEL[a.minRelevance]}</Pill>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(a)} className="btn-ghost">
                    Editar
                  </button>
                  <button onClick={() => toggle(a)} className="btn-ghost">
                    {a.isActive ? "Desativar" : "Ativar"}
                  </button>
                  <button onClick={() => remove(a.id)} className="btn-danger">
                    Excluir
                  </button>
                </div>
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <p className="label">
                  Notícias que bateram com o alerta ({a.matches.length})
                </p>
                {a.matches.length ? (
                  <ul className="space-y-1.5">
                    {a.matches.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                        <Link href={`/articles/${m.id}`} className="truncate text-zinc-200 hover:text-white">
                          {m.title}
                        </Link>
                        <span className="shrink-0 text-xs text-zinc-500">
                          {m.sourceName} · {timeAgo(m.publishedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {a.isActive
                      ? "Nenhuma notícia recente bateu com este alerta ainda."
                      : "Alerta inativo."}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

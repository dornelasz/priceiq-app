'use client';

import { useState } from 'react';
import { catalogApi } from '@/lib/api';
import type {
  CatalogCandidate,
  CatalogMatch,
  CatalogDiscoveryRun,
} from '@/lib/types';

interface Props {
  params: { id: string };
}

type Tab = 'candidates' | 'matches' | 'runs';

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    validated: 'bg-green-100 text-green-800',
    matched: 'bg-blue-100 text-blue-800',
    partial: 'bg-yellow-100 text-yellow-800',
    candidate: 'bg-gray-100 text-gray-600',
    rejected: 'bg-red-100 text-red-700',
    blocked: 'bg-red-200 text-red-900',
    price_not_found: 'bg-orange-100 text-orange-800',
    product_mismatch: 'bg-orange-200 text-orange-900',
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-gray-100 text-gray-600',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-700',
    no_candidates: 'bg-orange-100 text-orange-800',
  };
  const cls = colors[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default function CatalogPage({ params }: Props) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [tab, setTab] = useState<Tab>('candidates');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CatalogCandidate[]>([]);
  const [matches, setMatches] = useState<CatalogMatch[]>([]);
  const [runs, setRuns] = useState<CatalogDiscoveryRun[]>([]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const [c, m, r] = await Promise.all([
        catalogApi.candidates(params.id, q),
        catalogApi.matches(params.id, q),
        catalogApi.discoveryRuns(params.id, q),
      ]);
      setCandidates(c.candidates);
      setMatches(m.matches);
      setRuns(r.runs);
      setSubmitted(q);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Catálogo de Produtos</h1>

      <form onSubmit={handleSearch} className="mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex: ssd 1tb nvme"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {submitted && (
        <>
          <div className="mb-1 text-xs text-gray-500">
            Query normalizada: <span className="font-mono">{submitted}</span>
          </div>
          <div className="mb-4 flex gap-1 border-b border-gray-200">
            {(['candidates', 'matches', 'runs'] as Tab[]).map((t) => {
              const count = t === 'candidates' ? candidates.length : t === 'matches' ? matches.length : runs.length;
              const label = t === 'candidates' ? 'Candidatos' : t === 'matches' ? 'Matches' : 'Discovery Runs';
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          {tab === 'candidates' && (
            <CandidatesTable candidates={candidates} />
          )}
          {tab === 'matches' && (
            <MatchesTable matches={matches} />
          )}
          {tab === 'runs' && (
            <RunsTable runs={runs} />
          )}
        </>
      )}
    </div>
  );
}

function CandidatesTable({ candidates }: { candidates: CatalogCandidate[] }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-gray-500">Nenhum candidato encontrado.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="pb-2 pr-4">URL</th>
            <th className="pb-2 pr-4">Produto</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Score</th>
            <th className="pb-2 pr-4">Preço BRL</th>
            <th className="pb-2">Fonte</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4">
                <a
                  href={c.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[200px] truncate block text-blue-600 hover:underline"
                  title={c.productUrl}
                >
                  {c.productUrl.replace(/^https?:\/\//, '').slice(0, 40)}…
                </a>
              </td>
              <td className="py-2 pr-4 max-w-[180px] truncate" title={c.productName ?? ''}>
                {c.productName ?? '—'}
              </td>
              <td className="py-2 pr-4">
                <StatusBadge status={c.status} />
              </td>
              <td className="py-2 pr-4">{fmt(c.matchScore, 0)}</td>
              <td className="py-2 pr-4">
                {c.priceBrl != null ? `R$ ${fmt(c.priceBrl)}` : '—'}
              </td>
              <td className="py-2 text-xs text-gray-500">{c.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchesTable({ matches }: { matches: CatalogMatch[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-gray-500">Nenhum match encontrado.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="pb-2 pr-4">Candidato ID</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Score</th>
            <th className="pb-2 pr-4">Confiança</th>
            <th className="pb-2">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono text-xs">{m.candidateId.slice(0, 8)}…</td>
              <td className="py-2 pr-4">
                <StatusBadge status={m.matchStatus} />
              </td>
              <td className="py-2 pr-4">{fmt(m.matchScore, 0)}</td>
              <td className="py-2 pr-4">{m.confidence != null ? `${Math.round(m.confidence * 100)}%` : '—'}</td>
              <td className="py-2 text-xs text-gray-500">{m.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ runs }: { runs: CatalogDiscoveryRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-gray-500">Nenhuma execução encontrada.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="pb-2 pr-4">Iniciado em</th>
            <th className="pb-2 pr-4">Fonte</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Encontrados</th>
            <th className="pb-2">Salvos</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4 text-xs text-gray-600">
                {new Date(r.startedAt).toLocaleString('pt-BR')}
              </td>
              <td className="py-2 pr-4 text-xs">{r.source}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={r.status} />
              </td>
              <td className="py-2 pr-4">{r.candidatesFound}</td>
              <td className="py-2">{r.candidatesSaved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

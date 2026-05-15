'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ProgressSearch from '@/components/ProgressSearch';
import ResultCard from '@/components/ResultCard';
import { searchesApi, suppliersApi } from '@/lib/api';
import type { Search, SearchResult, Supplier } from '@/lib/types';

const POLL_INTERVAL_MS = 2_500;

export default function ResultsPage() {
  const params = useParams<{ searchId: string }>();
  const searchId = params?.searchId ?? '';

  const [search, setSearch] = useState<Search | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [suppliers, setSuppliers] = useState<Map<string, Supplier>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        searchesApi.get(searchId),
        searchesApi.results(searchId).catch(() => ({ items: [] as SearchResult[] })),
      ]);
      setSearch(s);
      setResults(r.items);
      setLoadError(null);
      return s;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, [searchId]);

  useEffect(() => {
    if (!searchId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loop() {
      const s = await fetchAll();
      if (!alive) return;
      if (s && (s.status === 'pending' || s.status === 'running')) {
        timer = setTimeout(loop, POLL_INTERVAL_MS);
      }
    }
    void loop();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [searchId, fetchAll]);

  // Carrega suppliers uma única vez para resolver nomes
  useEffect(() => {
    suppliersApi.list().then(({ items }) => {
      setSuppliers(new Map(items.map((s) => [s.id, s])));
    }).catch(() => { /* ok, mostra "—" */ });
  }, []);

  if (loadError) {
    return (
      <>
        <h2 style={{ color: '#E8F0FE', fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Busca não encontrada</h2>
        <p style={{ color: '#FF4D6D', fontSize: 13, marginBottom: 14 }}>{loadError}</p>
        <Link href="/" className="btn btn-g btn-sm" style={{ width: 'auto', display: 'inline-flex' }}>← Voltar para Início</Link>
      </>
    );
  }

  if (!search) {
    return <p style={{ color: '#8896AA' }}>Carregando…</p>;
  }

  const inProgress = search.status === 'pending' || search.status === 'running';
  const totalSuppliers = search.selected_supplier_ids.length;
  const completedSuppliers = results.length;
  const valid = results.filter((r) => r.total_brl !== null && !r.error_message);
  const errors = results.filter((r) => r.error_message);
  const sorted = [...valid].sort((a, b) => (a.total_brl ?? Infinity) - (b.total_brl ?? Infinity));
  const bestPrice = sorted[0]?.total_brl ?? 0;
  const currentLabel = inProgress ? undefined : undefined; // backend não expõe "atual" por enquanto

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ color: '#E8F0FE', fontSize: 19, fontWeight: 800, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {search.query}
          </h2>
          <p style={{ color: '#4A5568', fontSize: 13 }}>
            {inProgress
              ? `Buscando… (${completedSuppliers}/${totalSuppliers})`
              : `${valid.length} resultado${valid.length !== 1 ? 's' : ''}${errors.length ? ` · ${errors.length} erro${errors.length !== 1 ? 's' : ''}` : ''}`}
          </p>
        </div>
        <Link href="/" className="btn btn-g btn-sm" style={{ width: 'auto', flexShrink: 0 }}>
          Nova busca
        </Link>
      </div>

      {inProgress && (
        <ProgressSearch total={totalSuppliers} done={completedSuppliers} currentLabel={currentLabel} />
      )}

      {errors.length > 0 && (
        <div style={{
          marginBottom: 14,
          background: 'rgba(255,77,109,.08)',
          border: '1px solid rgba(255,77,109,.25)',
          borderRadius: 12,
          padding: 12,
        }}>
          <p style={{ color: '#FF4D6D', fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
            Erros técnicos
          </p>
          {errors.slice(0, 5).map((e) => (
            <p key={e.id} style={{ color: '#FFB8C6', fontSize: 12, marginBottom: 5 }}>
              <strong>{suppliers.get(e.supplier_id)?.name ?? 'Fornecedor'}:</strong> {(e.error_message ?? '').slice(0, 180)}
            </p>
          ))}
        </div>
      )}

      {!inProgress && valid.length === 0 && errors.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          background: '#111827',
          borderRadius: 18,
          border: '1px solid #1C2A3A',
        }}>
          <p style={{ color: '#8896AA', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Nenhum resultado</p>
          <p style={{ color: '#4A5568', fontSize: 14 }}>
            Tente outros termos ou fornecedores diferentes.
          </p>
        </div>
      )}

      {sorted.map((r, i) => {
        const diff = i === 0 ? null : bestPrice > 0 ? ((r.total_brl ?? 0) - bestPrice) / bestPrice * 100 : null;
        return (
          <ResultCard
            key={r.id}
            result={r}
            supplier={suppliers.get(r.supplier_id)}
            isBest={i === 0}
            priceDiffPct={diff}
          />
        );
      })}
    </>
  );
}

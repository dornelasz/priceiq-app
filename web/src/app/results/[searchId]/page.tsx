'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ProgressSearch from '@/components/ProgressSearch';
import ResultCard from '@/components/ResultCard';
import { Refresh } from '@/components/Icons';
import { showToast } from '@/components/Toast';
import { searchesApi, suppliersApi } from '@/lib/api';
import { statusLabel } from '@/lib/resultStatus';
import type { SearchResultsResponse, Supplier } from '@/lib/types';

const POLL_INTERVAL_MS = 2_500;

export default function ResultsPage() {
  const params = useParams<{ searchId: string }>();
  const router = useRouter();
  const searchId = params?.searchId ?? '';

  const [data, setData] = useState<SearchResultsResponse | null>(null);
  const [suppliers, setSuppliers] = useState<Map<string, Supplier>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const r = await searchesApi.results(searchId);
      setData(r);
      setLoadError(null);
      return r;
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
      const r = await fetchAll();
      if (!alive) return;
      if (r && (r.search.status === 'pending' || r.search.status === 'running')) {
        timer = setTimeout(loop, POLL_INTERVAL_MS);
      }
    }
    void loop();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [searchId, fetchAll]);

  // Carrega suppliers uma vez (para resolver nomes do mapa)
  useEffect(() => {
    suppliersApi.list().then(({ items }) => {
      setSuppliers(new Map(items.map((s) => [s.id, s])));
    }).catch(() => {});
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

  if (!data) {
    return <p style={{ color: '#8896AA' }}>Carregando…</p>;
  }

  const { search, progress, results, errors, best } = data;
  const inProgress = search.status === 'pending' || search.status === 'running';
  const bestPrice = best?.total_brl ?? 0;

  async function onForceRefresh() {
    if (refreshing || inProgress) return;
    setRefreshing(true);
    try {
      const supplierIds = search.selected_supplier_ids;
      const created = await searchesApi.create(search.query, supplierIds, true);
      showToast('Buscando novamente sem cache…');
      router.push(`/results/${created.searchId}`);
    } catch (e) {
      showToast((e as Error).message, 'err');
      setRefreshing(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ color: '#E8F0FE', fontSize: 19, fontWeight: 800, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {search.query}
          </h2>
          <p style={{ color: '#4A5568', fontSize: 13 }}>
            {inProgress
              ? `Buscando… ${progress.completed}/${progress.total}`
              : `${results.length} resultado${results.length !== 1 ? 's' : ''}${errors.length ? ` · ${errors.length} erro${errors.length !== 1 ? 's' : ''}` : ''}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!inProgress && (
            <button
              type="button"
              className="btn btn-g btn-sm"
              style={{ width: 'auto' }}
              onClick={onForceRefresh}
              disabled={refreshing}
              title="Refazer a busca ignorando o cache"
            >
              <Refresh size={14} /> {refreshing ? 'Atualizando…' : 'Atualizar agora'}
            </button>
          )}
          <Link href="/" className="btn btn-g btn-sm" style={{ width: 'auto' }}>
            Nova busca
          </Link>
        </div>
      </div>

      {inProgress && (
        <ProgressSearch total={progress.total} done={progress.completed} />
      )}

      {/* Banner de status para partial_failed / failed */}
      {!inProgress && search.status === 'partial_failed' && (
        <div style={{
          background: 'rgba(255,184,0,.1)',
          border: '1px solid rgba(255,184,0,.3)',
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
        }}>
          <p style={{ color: '#FFB800', fontSize: 13, fontWeight: 700 }}>
            ⚠️ Busca parcial — {results.length} fornecedor{results.length !== 1 ? 'es' : ''} OK, {errors.length} falharam
          </p>
        </div>
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
            {results.length > 0
              ? 'Alguns fornecedores não retornaram resultado válido'
              : 'Nenhum fornecedor retornou resultado válido'}
          </p>
          {errors.slice(0, 8).map((e) => (
            <p key={e.supplier_id} style={{ color: '#FFB8C6', fontSize: 12, marginBottom: 5 }}>
              <strong>{e.supplier_name}:</strong> {statusLabel(e.status)}
            </p>
          ))}
        </div>
      )}

      {!inProgress && results.length === 0 && errors.length === 0 && (
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

      {results.map((r) => {
        const diff = best && bestPrice > 0
          ? ((r.total_brl ?? 0) - bestPrice) / bestPrice * 100
          : null;
        const isBest = best ? r.id === best.id : false;
        return (
          <ResultCard
            key={r.id}
            result={r}
            supplier={suppliers.get(r.supplier_id)}
            isBest={isBest}
            priceDiffPct={isBest ? null : diff}
          />
        );
      })}
    </>
  );
}

import Link from 'next/link';
import { Eye, Trophy } from '@/components/Icons';
import { searchesApi } from '@/lib/api';
import { fmt, fmtDate } from '@/lib/format';
import type { Search } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function loadHistory(): Promise<Search[]> {
  try {
    const r = await searchesApi.list(50, 0);
    return r.items;
  } catch {
    return [];
  }
}

export default async function HistoryPage() {
  const items = await loadHistory();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#E8F0FE', fontSize: 20, fontWeight: 800, marginBottom: 3 }}>Histórico</h2>
          <p style={{ color: '#4A5568', fontSize: 13 }}>{items.length} buscas</p>
        </div>
      </div>

      {items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#111827', borderRadius: 18, border: '1px solid #1C2A3A' }}>
          <p style={{ color: '#8896AA', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            Nenhuma busca ainda
          </p>
          <p style={{ color: '#4A5568', fontSize: 14, marginBottom: 20 }}>
            Faça uma busca na tela Início.
          </p>
          <Link href="/" className="btn btn-g btn-sm" style={{ margin: '0 auto', width: 'auto', display: 'inline-flex' }}>
            Ir para Início
          </Link>
        </div>
      )}

      {items.map((rec) => (
        <div key={rec.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: '#E8F0FE', fontWeight: 700, fontSize: 16, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {rec.query}
              </p>
              <p style={{ color: '#4A5568', fontSize: 12 }}>
                {fmtDate(rec.created_at)} · {rec.status}
              </p>
            </div>
            {rec.best_total_brl && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ color: '#4A5568', fontSize: 10, marginBottom: 2 }}>Melhor preço</p>
                <p style={{ color: '#00D4FF', fontWeight: 800, fontSize: 17 }}>R$ {fmt(rec.best_total_brl)}</p>
                {rec.best_supplier && <p style={{ color: '#4A5568', fontSize: 10 }}>{rec.best_supplier}</p>}
              </div>
            )}
          </div>
          {rec.best_supplier && (
            <div className="ai-best">
              <span style={{ color: '#FFB800', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <Trophy size={15} /> Melhor opção:
              </span>
              <span style={{ color: '#8896AA', fontSize: 13, marginLeft: 6 }}>{rec.best_supplier}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/results/${rec.id}`} className="btn btn-p" style={{ flex: 1 }}>
              <Eye size={15} color="#fff" /> Ver Resultados
            </Link>
          </div>
        </div>
      ))}
    </>
  );
}

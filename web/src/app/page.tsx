import Link from 'next/link';
import { Zap, Refresh } from '@/components/Icons';
import RateBar from '@/components/RateBar';
import SearchBox from '@/components/SearchBox';
import { searchesApi } from '@/lib/api';
import { fmt, fmtDateShort } from '@/lib/format';
import type { Search } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function loadRecentSearches(): Promise<Search[]> {
  try {
    const r = await searchesApi.list(6, 0);
    return r.items;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const recent = await loadRecentSearches();

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(0,212,255,.1)',
          border: '1px solid rgba(0,212,255,.28)',
          borderRadius: 99,
          padding: '5px 14px',
          marginBottom: 12,
        }}>
          <Zap size={12} color="#00D4FF" />
          <span style={{ color: '#00D4FF', fontSize: 12, fontWeight: 700 }}>Busca real com IA</span>
        </div>
        <h1 style={{ color: '#E8F0FE', fontSize: 24, fontWeight: 800, marginBottom: 6, letterSpacing: '-.4px' }}>
          Compare preços<br />em tempo real
        </h1>
        <p style={{ color: '#8896AA', fontSize: 14 }}>Dados reais, cotação ao vivo, sem invenção</p>
      </div>

      <RateBar />

      <SearchBox />

      {recent.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Refresh size={13} color="#4A5568" />
            <span style={{ color: '#4A5568', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' }}>
              Buscas recentes
            </span>
          </div>
          {recent.map((h) => (
            <Link key={h.id} href={`/results/${h.id}`} className="hcard" style={{
              display: 'block',
              background: '#111827',
              border: '1px solid #1C2A3A',
              borderRadius: 14,
              padding: '14px 16px',
              marginBottom: 8,
              textDecoration: 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#E8F0FE', fontSize: 14, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.query}
                  </p>
                  <p style={{ color: '#4A5568', fontSize: 12 }}>
                    {fmtDateShort(h.created_at)} · {h.status}
                    {h.best_total_brl ? ` · R$ ${fmt(h.best_total_brl)}` : ''}
                  </p>
                </div>
                <span style={{ color: '#00D4FF' }}>→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

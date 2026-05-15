'use client';

interface Props {
  total: number;
  done: number;
  currentLabel?: string;
}

export default function ProgressSearch({ total, done, currentLabel }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00D4FF', animation: 'pulse 1s infinite', flexShrink: 0 }} />
          <span style={{ color: '#E8F0FE', fontSize: 14, fontWeight: 500 }}>
            {currentLabel ? `Buscando ${currentLabel}…` : 'Buscando…'}
          </span>
        </div>
        <span style={{ color: '#00D4FF', fontWeight: 800 }}>{done}/{total}</span>
      </div>
      <div className="prog-wrap">
        <div className="prog-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

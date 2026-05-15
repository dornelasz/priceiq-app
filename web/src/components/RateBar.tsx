'use client';

import { useCallback, useEffect, useState } from 'react';
import { ratesApi } from '@/lib/api';
import { fmt4, rateAge } from '@/lib/format';
import { showToast } from './Toast';
import { Refresh } from './Icons';
import type { RatesPayload } from '@/lib/types';

const STALE_MS = 60_000;

export default function RateBar() {
  const [rates, setRates] = useState<RatesPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const r = force ? await ratesApi.refresh() : await ratesApi.current();
      setRates(r);
      return r;
    } catch (e) {
      console.warn('[rates] erro', (e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load(false);
    const i = setInterval(() => void load(false), 60_000);
    return () => clearInterval(i);
  }, [load]);

  async function onRefresh() {
    if (loading) return;
    setLoading(true);
    showToast('Atualizando cotações…');
    const r = await load(true);
    setLoading(false);
    if (!r) return showToast('Sem cotação disponível — tente novamente em 1 minuto', 'err');
    if (!r.from_cache && !r.partial)
      showToast(`Cotação atualizada: USD ${fmt4(r.usd ?? 0)} · EUR ${fmt4(r.eur ?? 0)} · CNY ${fmt4(r.cny ?? 0)}`);
    else if (!r.from_cache && r.partial)
      showToast(`Atualização parcial: USD ${fmt4(r.usd ?? 0)}`);
    else if (r.usd)
      showToast(`Mantendo última cotação: USD ${fmt4(r.usd)} (próxima tentativa em 1min)`);
  }

  const stale = rates?.fetched_at
    ? Date.now() - new Date(rates.fetched_at).getTime() > STALE_MS
    : false;

  return (
    <div className="rate-bar">
      <div>
        <p style={{ color: '#4A5568', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 }}>
          Cotação Investing.com
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#E8F0FE', fontSize: 13, fontWeight: 600 }}>
            USD <span style={{ color: '#00D4FF' }}>{rates?.usd ? fmt4(rates.usd) : '—'}</span>
          </span>
          <span style={{ color: '#E8F0FE', fontSize: 13, fontWeight: 600 }}>
            CNY <span style={{ color: '#00D4FF' }}>{rates?.cny ? fmt4(rates.cny) : '—'}</span>
          </span>
          <span style={{ color: '#E8F0FE', fontSize: 13, fontWeight: 600 }}>
            EUR <span style={{ color: '#00D4FF' }}>{rates?.eur ? fmt4(rates.eur) : '—'}</span>
          </span>
        </div>
        <p style={{ color: stale ? '#FFB800' : '#4A5568', fontSize: 11, marginTop: 3 }}>
          {stale ? '⚠️ Cotação antiga — ' : ''}
          Última atualização: {rates?.fetched_at ? new Date(rates.fetched_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca'} ({rateAge(rates?.fetched_at)})
        </p>
      </div>
      <button onClick={onRefresh} disabled={loading} className="rate-refresh-btn">
        <Refresh size={14} /> Atualizar
      </button>
    </div>
  );
}

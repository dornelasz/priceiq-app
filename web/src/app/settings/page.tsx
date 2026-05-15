'use client';

import { useEffect, useState } from 'react';
import { Refresh } from '@/components/Icons';
import { showToast } from '@/components/Toast';
import { ratesApi } from '@/lib/api';
import { fmt4, rateAge } from '@/lib/format';
import type { RatesPayload } from '@/lib/types';

export default function SettingsPage() {
  const [rates, setRates] = useState<RatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    ratesApi.current()
      .then((r) => { if (alive) setRates(r); })
      .catch(() => { /* silencioso */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    showToast('Atualizando cotações…');
    try {
      const r = await ratesApi.refresh();
      setRates(r);
      if (!r.from_cache && !r.partial)
        showToast(`Cotação atualizada: USD ${fmt4(r.usd ?? 0)} · EUR ${fmt4(r.eur ?? 0)} · CNY ${fmt4(r.cny ?? 0)}`);
      else if (!r.from_cache && r.partial)
        showToast(`Atualização parcial: USD ${fmt4(r.usd ?? 0)}`);
      else if (r.usd)
        showToast(`Mantendo última cotação: USD ${fmt4(r.usd)}`);
      else showToast('Sem cotação disponível', 'err');
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setRefreshing(false);
    }
  }

  const stale = rates?.fetched_at
    ? Date.now() - new Date(rates.fetched_at).getTime() > 60_000
    : false;

  return (
    <>
      <h2 style={{ color: '#E8F0FE', fontSize: 20, fontWeight: 800, marginBottom: 20 }}>Configurações</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Cotação */}
        <div className="card" style={{ borderColor: 'rgba(0,212,255,.28)' }}>
          <p style={{ color: '#00D4FF', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', marginBottom: 14, letterSpacing: '.5px' }}>
            💱 Cotação ao vivo
          </p>
          <div className="g3" style={{ marginBottom: 14 }}>
            <RateBox label="USD/BRL" value={rates?.usd} warning={rates?.warnings?.usd} />
            <RateBox label="CNY/BRL" value={rates?.cny} warning={rates?.warnings?.cny} />
            <RateBox label="EUR/BRL" value={rates?.eur} warning={rates?.warnings?.eur} />
          </div>
          <p style={{ color: stale ? '#FFB800' : '#4A5568', fontSize: 12, marginBottom: 12 }}>
            {stale ? '⚠️ Cotação desatualizada · ' : ''}
            Fonte: Investing.com · Última atualização: {rates?.fetched_at ? new Date(rates.fetched_at).toLocaleTimeString('pt-BR') : '—'} ({rateAge(rates?.fetched_at)})
          </p>
          <button className="btn btn-p" onClick={onRefresh} disabled={refreshing}>
            <Refresh size={14} color="#fff" />
            {refreshing ? 'Atualizando…' : 'Atualizar cotação agora'}
          </button>
        </div>

        {/* API info */}
        <div className="card">
          <p style={{ color: '#8896AA', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '.5px' }}>
            🔐 Chave Gemini
          </p>
          <p style={{ color: '#4A5568', fontSize: 12, lineHeight: 1.5 }}>
            A chave da API Gemini fica armazenada com segurança no backend (variável de ambiente <code style={{ color: '#00D4FF', background: '#070B14', padding: '2px 6px', borderRadius: 4 }}>GEMINI_API_KEY</code>) e nunca é enviada ao navegador.
            <br /><br />
            Se você for o administrador, configure no <code style={{ color: '#00D4FF' }}>server/.env</code> antes do deploy.
          </p>
        </div>

        {/* Backend */}
        <div className="card">
          <p style={{ color: '#8896AA', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '.5px' }}>
            ⚙️ Sobre
          </p>
          <p style={{ color: '#4A5568', fontSize: 12, lineHeight: 1.5 }}>
            PriceIQ usa Postgres para persistência, Redis para cache e Fastify como API.
            <br />Cotação Investing.com é refrescada a cada 1 minuto.
            <br />Buscas rodam em paralelo com timeout por fornecedor.
          </p>
        </div>
      </div>

      {loading && <p style={{ color: '#4A5568', fontSize: 12, marginTop: 10 }}>Carregando…</p>}
    </>
  );
}

function RateBox({ label, value, warning }: { label: string; value: number | null | undefined; warning?: string | null }) {
  return (
    <div style={{ background: '#070B14', borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ color: '#4A5568', fontSize: 10, marginBottom: 3 }}>{label}</p>
      <p style={{ color: '#00D4FF', fontWeight: 800, fontSize: 16 }}>
        {value ? `R$ ${fmt4(value)}` : '—'}
      </p>
      {warning && (
        <p style={{ color: '#FFB800', fontSize: 10, marginTop: 3 }}>⚠️ {warning}</p>
      )}
    </div>
  );
}

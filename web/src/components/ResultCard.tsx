'use client';

import { useState } from 'react';
import { Alert, Eye, Link as LinkIcon, Search as SearchIcon, Shield, Trophy } from './Icons';
import { fmt, fmt4, fmtDate } from '@/lib/format';
import type { SearchResult, Supplier } from '@/lib/types';

interface Props {
  result: SearchResult;
  supplier?: Supplier;
  isBest: boolean;
  priceDiffPct?: number | null;
}

function isProductUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    /\/MLB\d{5,}/.test(url) ||
    /\/dp\/[A-Z0-9]{8,}/.test(url) ||
    /-i\.\d{5,}\.\d{5,}/.test(url) ||
    /\/p\/[a-z0-9]{8,}[\/.]/i.test(url) ||
    /\/item\/\d{8,}/.test(url) ||
    /\/product[-_]detail\//i.test(url)
  );
}

export default function ResultCard({ result, supplier, isBest, priceDiffPct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const r = result;
  const supplierName = supplier?.name ?? '—';
  const linkType = isProductUrl(r.product_url) ? 'product' : 'search';
  const highConf = (r.confidence ?? 0) >= 85;
  const lowConf  = (r.confidence ?? 0) > 0 && (r.confidence ?? 0) < 75;

  const cls = `res-card${isBest ? ' best' : ''}`;

  return (
    <div className={cls}>
      <div className="res-body">
        {/* Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {isBest && (
            <span className="tag" style={{ background: 'rgba(0,212,255,.12)', color: '#00D4FF', border: '1px solid rgba(0,212,255,.3)' }}>
              💰 Menor preço
            </span>
          )}
          {highConf && (
            <span className="tag" style={{ background: 'rgba(0,229,160,.1)', color: '#00E5A0', border: '1px solid rgba(0,229,160,.3)' }}>
              <Shield size={13} /> Alta confiança
            </span>
          )}
          {r.from_cache && (
            <span className="tag" style={{ background: 'rgba(74,85,104,.15)', color: '#8896AA', border: '1px solid rgba(74,85,104,.3)' }}>
              📦 Cache
            </span>
          )}
          {r.available === false && (
            <span className="tag" style={{ background: 'rgba(255,77,109,.1)', color: '#FF4D6D', border: '1px solid rgba(255,77,109,.3)' }}>
              Indisponível
            </span>
          )}
          {lowConf && (
            <span className="tag" style={{ background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.3)' }}>
              <Alert size={13} /> Conferir dados
            </span>
          )}
          {priceDiffPct !== null && priceDiffPct !== undefined && priceDiffPct > 0 && (
            <span className="tag" style={{ background: 'rgba(74,85,104,.15)', color: '#8896AA', border: '1px solid rgba(74,85,104,.3)' }}>
              +{priceDiffPct.toFixed(1)}% mais caro
            </span>
          )}
        </div>

        {/* Nome + preço */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: '#E8F0FE', fontSize: 15, fontWeight: 700, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.product_name || '(sem nome)'}
            </p>
            <p style={{ color: '#00D4FF', fontSize: 13, fontWeight: 600 }}>{supplierName}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ color: isBest ? '#00D4FF' : '#E8F0FE', fontSize: 22, fontWeight: 800, margin: 0 }}>
              R$ {fmt(r.total_brl ?? 0)}
            </p>
            {r.currency && r.currency !== 'BRL' && r.price !== null && (
              <p style={{ color: '#4A5568', fontSize: 11 }}>{r.currency} {fmt(r.price)}</p>
            )}
          </div>
        </div>

        {/* Cotação info (internacionais) */}
        {r.currency && r.currency !== 'BRL' && r.exchange_rate_used && (
          <div style={{ background: '#070B14', borderRadius: 8, padding: '7px 10px', fontSize: 11, color: '#4A5568', marginBottom: 8 }}>
            ℹ️ <span style={{ color: '#8896AA' }}>
              {r.currency}/BRL: <strong style={{ color: '#00D4FF' }}>{fmt4(r.exchange_rate_used)}</strong>
            </span>
          </div>
        )}

        {/* Grid */}
        <div className="pgrid">
          <div className="pcell">
            <p className="plabel">Frete</p>
            <p className="pval" style={{ fontSize: 12 }}>
              {(r.freight ?? 0) > 0
                ? `${r.currency ?? ''} ${fmt(r.freight ?? 0)}`
                : <span style={{ color: '#FFB800' }}>Não encontrado</span>}
            </p>
          </div>
          <div className="pcell">
            <p className="plabel">Confiança</p>
            <p className={`pval ${highConf ? 'conf-high' : lowConf ? 'conf-low' : 'conf-med'}`} style={{ fontSize: 12 }}>
              {r.confidence ?? '—'}{r.confidence ? '%' : ''}
            </p>
          </div>
          <div className="pcell">
            <p className="plabel">Match</p>
            <p className="pval" style={{ fontSize: 12 }}>
              {r.match_score ?? '—'}{r.match_score ? '%' : ''}
            </p>
          </div>
        </div>

        {/* Vendedor */}
        {r.seller_name && (
          <div style={{ marginBottom: 12, fontSize: 12 }}>
            <span style={{ color: '#4A5568', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.3px' }}>Vendedor: </span>
            <span style={{ color: '#8896AA' }}>{r.seller_name}</span>
          </div>
        )}

        {/* Warning */}
        {r.warning && (
          <p style={{ color: '#FFB800', fontSize: 12, marginBottom: 8 }}>⚠️ {r.warning}</p>
        )}

        {/* Botões */}
        <div className="arow">
          <a
            href={r.product_url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={`arow-btn${linkType === 'product' ? ' primary' : ''}`}
            title={linkType === 'product' ? 'Link direto ao produto' : 'Link para busca no site'}
          >
            {linkType === 'product' ? <LinkIcon size={15} /> : <SearchIcon size={15} />}
            {linkType === 'product' ? 'Ver Produto' : 'Buscar no site'}
          </a>
          <button className="arow-btn icon-only" onClick={() => setExpanded((v) => !v)} title="Detalhes">
            <Eye size={15} />
          </button>
        </div>

        {linkType !== 'product' && (
          <p style={{ color: '#FFB800', fontSize: 10, marginTop: 4 }}>
            <Alert size={11} /> Link de busca — produto encontrado, mas sem link direto.
          </p>
        )}

        <p style={{ color: '#4A5568', fontSize: 10, marginTop: 8, textAlign: 'right' }}>
          {fmtDate(r.collected_at)}
        </p>
      </div>

      {expanded && (
        <div className="res-extra open">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <DetailCell label="Fornecedor" value={supplierName} />
            <DetailCell label="Vendedor" value={r.seller_name ?? '—'} />
            <DetailCell label="Preço original" value={r.currency && r.price ? `${r.currency} ${fmt(r.price)}` : '—'} />
            <DetailCell label="Total BRL" value={`R$ ${fmt(r.total_brl ?? 0)}`} valueColor="#00D4FF" />
            {r.currency && r.currency !== 'BRL' && r.exchange_rate_used && (
              <DetailCell label="Cotação usada" value={`${r.currency}/BRL = ${fmt4(r.exchange_rate_used)}`} />
            )}
            <DetailCell label="Disponível" value={r.available === false ? '❌ Não' : '✅ Sim'} />
            <DetailCell label="Confiança" value={r.confidence ? `${r.confidence}%` : '—'} />
            <DetailCell label="Match score" value={r.match_score ? `${r.match_score}%` : '—'} />
          </div>
          {r.error_message && (
            <p style={{ color: '#FFB800', fontSize: 12, padding: '7px 10px', background: '#0D1320', borderRadius: 8 }}>
              ⚠️ {r.error_message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DetailCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p style={{ color: '#4A5568', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>{label}</p>
      <p style={{ color: valueColor ?? '#E8F0FE', fontSize: 13, fontWeight: 700 }}>{value}</p>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Alert, Eye, Link as LinkIcon, Search as SearchIcon } from './Icons';
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
  const supplierName = r.supplier_name || supplier?.name || '—';
  // link_type vem do backend (validado). Fallback para detecção local pelo padrão.
  const linkType: 'product' | 'search' | 'unverified' =
    r.link_type ?? (isProductUrl(r.product_url) ? 'product' : 'search');
  const isValidatedProduct = linkType === 'product' && r.link_validated;
  const isSearchOnly = linkType === 'search';

  const cls = `res-card${isBest ? ' best' : ''}`;

  return (
    <div className={cls}>
      <div className="res-body">
        {/* Badges — objetivos, sem confidence */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {isBest && (
            <span className="tag" style={{ background: 'rgba(0,212,255,.12)', color: '#00D4FF', border: '1px solid rgba(0,212,255,.3)' }}>
              💰 Menor preço
            </span>
          )}
          {isValidatedProduct && (
            <span className="tag" style={{ background: 'rgba(0,229,160,.1)', color: '#00E5A0', border: '1px solid rgba(0,229,160,.3)' }}>
              <LinkIcon size={13} /> Link validado
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
          {r.error_message && (
            <span className="tag" style={{ background: 'rgba(255,77,109,.1)', color: '#FF4D6D', border: '1px solid rgba(255,77,109,.3)' }}>
              <Alert size={13} /> Erro
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

        {/* Frete inline */}
        <div style={{ marginBottom: 10, fontSize: 12 }}>
          <span style={{ color: '#4A5568', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.3px' }}>Frete: </span>
          {(r.freight ?? 0) > 0
            ? <span style={{ color: '#E8F0FE', fontWeight: 700 }}>{r.currency ?? ''} {fmt(r.freight ?? 0)}</span>
            : /frete\s+gr[áa]tis\s+confirmado/i.test(r.warning ?? '')
              ? <span style={{ color: '#00E5A0', fontWeight: 700 }}>Grátis</span>
              : <span style={{ color: '#FFB800', fontWeight: 700 }}>Não encontrado</span>}
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

        {/* Botões — só mostra "Ver Produto" se link foi VALIDADO pelo backend */}
        <div className="arow">
          {isValidatedProduct ? (
            <a
              href={r.product_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="arow-btn primary"
              title="Link direto ao produto (validado)"
            >
              <LinkIcon size={15} /> Ver Produto
            </a>
          ) : isSearchOnly && r.product_url ? (
            <a
              href={r.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="arow-btn"
              title="Link para a página de busca do fornecedor"
            >
              <SearchIcon size={15} /> Ver busca
            </a>
          ) : (
            <span
              className="arow-btn"
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
              title="Link direto não confirmado"
            >
              <Alert size={15} /> Link não confirmado
            </span>
          )}
          <button className="arow-btn icon-only" onClick={() => setExpanded((v) => !v)} title="Detalhes">
            <Eye size={15} />
          </button>
        </div>

        {/* Aviso explícito sobre status do link */}
        {!isValidatedProduct && (
          <p style={{ color: '#FFB800', fontSize: 10, marginTop: 4 }}>
            <Alert size={11} />{' '}
            {isSearchOnly
              ? 'Sem link direto ao produto — abrirá a página de busca do fornecedor.'
              : r.validation_warning ?? 'Link do produto não foi validado.'}
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

'use client';

import { Check, Edit, Trash } from './Icons';
import type { Supplier } from '@/lib/types';

interface Props {
  supplier: Supplier;
  onToggleActive: (s: Supplier) => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
}

export default function SupplierCard({ supplier: s, onToggleActive, onEdit, onDelete }: Props) {
  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1C2A3A',
      borderRadius: 14,
      padding: '14px 16px',
      marginBottom: 10,
      opacity: s.active ? 1 : 0.6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ color: '#E8F0FE', fontWeight: 700, fontSize: 15 }}>{s.name}</span>
            <span className="tag" style={{
              background: s.active ? 'rgba(0,229,160,.1)' : 'rgba(74,85,104,.15)',
              color:      s.active ? '#00E5A0' : '#8896AA',
              border: `1px solid ${s.active ? 'rgba(0,229,160,.3)' : 'rgba(74,85,104,.3)'}`,
            }}>{s.active ? 'Ativo' : 'Inativo'}</span>
            <span className="tag" style={{ background: 'rgba(74,85,104,.15)', color: '#8896AA', border: '1px solid rgba(74,85,104,.3)' }}>{s.currency}</span>
            <span className="tag" style={{ background: 'rgba(74,85,104,.15)', color: '#8896AA', border: '1px solid rgba(74,85,104,.3)' }}>{s.type}</span>
          </div>
          <p style={{ color: '#4A5568', fontSize: 12 }}>{s.site} · {s.country}</p>
          {s.notes && <p style={{ color: '#4A5568', fontSize: 12, marginTop: 2 }}>{s.notes}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onToggleActive(s)}
            style={{
              background: s.active ? 'rgba(0,229,160,.1)' : '#0D1320',
              border: `1px solid ${s.active ? 'rgba(0,229,160,.4)' : '#1C2A3A'}`,
              borderRadius: 8,
              padding: 9,
              display: 'flex',
              alignItems: 'center',
              color: s.active ? '#00E5A0' : '#4A5568',
            }}
            aria-label="Ativar/Desativar"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(s)}
            style={{ background: '#0D1320', border: '1px solid #1C2A3A', borderRadius: 8, padding: 9, display: 'flex', alignItems: 'center', color: '#8896AA' }}
            aria-label="Editar"
          >
            <Edit size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(s)}
            style={{ background: 'rgba(255,77,109,.1)', border: '1px solid rgba(255,77,109,.2)', borderRadius: 8, padding: 9, display: 'flex', alignItems: 'center', color: '#FF4D6D' }}
            aria-label="Remover"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

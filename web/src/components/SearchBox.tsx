'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Search as SearchIcon, Check, Info } from './Icons';
import { showToast } from './Toast';
import { searchesApi, suppliersApi } from '@/lib/api';
import type { Supplier } from '@/lib/types';
import SupplierChip from './SupplierChip';

export default function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    suppliersApi.list().then(({ items }) => {
      if (!alive) return;
      setSuppliers(items.filter((s) => s.active));
      setError(null);
    }).catch((e: Error) => {
      if (!alive) return;
      setError(e.message);
    });
    return () => { alive = false; };
  }, []);

  function toggleChip(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  const clearSel = () => setSelectedIds([]);
  const selAll   = () => setSelectedIds(suppliers.map((s) => s.id));

  async function onSearch() {
    const q = query.trim();
    if (!q) return showToast('Digite um produto', 'err');
    setSubmitting(true);
    try {
      const created = await searchesApi.create(q, selectedIds.length ? selectedIds : undefined);
      router.push(`/results/${created.searchId}`);
    } catch (e) {
      showToast((e as Error).message || 'Falha ao iniciar busca', 'err');
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <Package size={20} color="#00D4FF" />
        </div>
        <input
          className="inp"
          style={{ paddingLeft: 46, borderRadius: 12, fontSize: 15 }}
          placeholder="Ex: iPhone 15 128GB, Nike Air Force 1..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onSearch();
            }
          }}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ color: '#4A5568', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {selectedIds.length > 0 ? (
              <>
                <Check size={15} color="#00D4FF" />
                <span style={{ color: '#00D4FF' }}>
                  {selectedIds.length} selecionado{selectedIds.length !== 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <>Pesquisar em todos ({suppliers.length})</>
            )}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {selectedIds.length < suppliers.length && (
              <button type="button" style={{ background: 'none', border: 'none', color: '#00D4FF', fontSize: 12, fontWeight: 600 }} onClick={selAll}>Todos</button>
            )}
            {selectedIds.length > 0 && (
              <button type="button" style={{ background: 'none', border: 'none', color: '#4A5568', fontSize: 12, fontWeight: 600 }} onClick={clearSel}>Limpar</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {suppliers.map((s) => (
            <SupplierChip key={s.id} id={s.id} name={s.name} active={selectedIds.includes(s.id)} onToggle={toggleChip} />
          ))}
          {!suppliers.length && !error && (
            <p style={{ color: '#4A5568', fontSize: 12 }}>Carregando fornecedores…</p>
          )}
          {error && (
            <p style={{ color: '#FF4D6D', fontSize: 12 }}>
              Não foi possível carregar fornecedores ({error}). Verifique o backend.
            </p>
          )}
        </div>

        {selectedIds.length > 0 && (
          <p style={{ color: '#4A5568', fontSize: 11, marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Info size={13} /> Buscará apenas nos fornecedores selecionados acima. Sem seleção = busca em todos.
          </p>
        )}
      </div>

      <button className="btn btn-p" onClick={onSearch} disabled={submitting}>
        <SearchIcon size={20} color="#fff" /> {submitting ? 'Iniciando…' : 'Buscar Preços Reais'}
      </button>
    </div>
  );
}

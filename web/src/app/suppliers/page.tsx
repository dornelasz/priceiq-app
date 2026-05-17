'use client';

import { useEffect, useState } from 'react';
import { Plus, Save, Refresh } from '@/components/Icons';
import SupplierCard from '@/components/SupplierCard';
import { showToast } from '@/components/Toast';
import { suppliersApi } from '@/lib/api';
import type { Supplier, SupplierInput } from '@/lib/types';

const EMPTY: SupplierInput = {
  name: '',
  site: '',
  search_url_template: '',
  country: 'Brasil',
  currency: 'BRL',
  type: 'Nacional',
  active: true,
  extraction_mode: 'jina_reader',
  extractor_config: {},
  notes: '',
};

export default function SuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<null | 'new' | { kind: 'edit'; id: string }>(null);
  const [form, setForm] = useState<SupplierInput>(EMPTY);

  async function reload() {
    setLoading(true);
    try {
      const r = await suppliersApi.list();
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function toggleActive(s: Supplier) {
    try {
      await suppliersApi.update(s.id, { active: !s.active });
      setItems((prev) => prev.map((x) => x.id === s.id ? { ...x, active: !x.active } : x));
      showToast(`${s.name} ${!s.active ? 'ativado' : 'desativado'}`);
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  function openEdit(s: Supplier) {
    setFormMode({ kind: 'edit', id: s.id });
    setForm({
      name: s.name,
      site: s.site,
      search_url_template: s.search_url_template,
      country: s.country,
      currency: s.currency,
      type: s.type,
      active: s.active,
      extraction_mode: s.extraction_mode,
      extractor_config: s.extractor_config,
      notes: s.notes ?? '',
    });
  }

  function openNew() {
    setFormMode('new');
    setForm(EMPTY);
  }

  async function onDelete(s: Supplier) {
    if (!confirm(`Remover "${s.name}"? Os registros de buscas anteriores também serão removidos.`)) return;
    try {
      await suppliersApi.remove(s.id);
      setItems((prev) => prev.filter((x) => x.id !== s.id));
      showToast(`${s.name} removido`);
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  async function saveForm() {
    try {
      if (!form.name || !form.site) {
        return showToast('Nome e site são obrigatórios', 'err');
      }
      // Site precisa parecer domínio válido (com TLD)
      const siteOk = /^(?:https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+/i.test(form.site.trim());
      if (!siteOk) {
        return showToast('Site precisa ser um domínio válido (ex: amazon.com.br)', 'err');
      }
      const template = form.search_url_template?.trim() ?? '';
      if (template) {
        if (!/^https?:\/\//i.test(template)) {
          return showToast('URL de busca precisa começar com http:// ou https://', 'err');
        }
        const hasPlaceholder = /\{(?:q|query|produto)\}/i.test(template);
        if (!hasPlaceholder) {
          const ok = confirm(
            'A URL de busca não contém {q}, {query} ou {produto}. ' +
            'A busca por palavra-chave pode não funcionar. Deseja continuar mesmo assim?',
          );
          if (!ok) return;
        }
      }
      if (formMode === 'new') {
        const created = await suppliersApi.create(form);
        setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        showToast(`${created.name} criado`);
      } else if (formMode && formMode.kind === 'edit') {
        const updated = await suppliersApi.update(formMode.id, form);
        setItems((prev) => prev.map((x) => x.id === updated.id ? updated : x));
        showToast(`${updated.name} atualizado`);
      }
      setFormMode(null);
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  const active = items.filter((s) => s.active).length;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ color: '#E8F0FE', fontSize: 20, fontWeight: 800, marginBottom: 3 }}>Fornecedores</h2>
          <p style={{ color: '#4A5568', fontSize: 13 }}>
            {items.length} cadastrados · {active} ativos
          </p>
        </div>
        <button className="btn btn-p btn-sm" onClick={openNew} style={{ width: 'auto' }}>
          <Plus size={16} color="#fff" /> Adicionar
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-g btn-sm" onClick={reload} style={{ flex: 1 }}>
          <Refresh size={14} /> Recarregar
        </button>
      </div>

      {formMode && (
        <div className="card" style={{ borderColor: 'rgba(0,212,255,.28)', marginBottom: 18 }}>
          <h3 style={{ color: '#E8F0FE', fontSize: 16, fontWeight: 700, marginBottom: 18 }}>
            {formMode === 'new' ? 'Novo' : 'Editar'} Fornecedor
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="g2">
              <div>
                <label className="lbl">Nome *</label>
                <input className="inp" placeholder="Ex: Amazon" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="lbl">Site *</label>
                <input className="inp" placeholder="amazon.com.br" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="lbl">URL de busca (use {`{q}`}, {`{query}`} ou {`{produto}`})</label>
              <input className="inp" placeholder="https://amazon.com.br/s?k={q}" value={form.search_url_template} onChange={(e) => setForm({ ...form, search_url_template: e.target.value })} />
              <p style={{ color: '#4A5568', fontSize: 11, marginTop: 5 }}>
                Exemplo: https://lista.mercadolivre.com.br/{`{q}`} · Sem template usamos /search?q=... no domínio.
              </p>
              {form.search_url_template && !/\{(?:q|query|produto)\}/i.test(form.search_url_template) && (
                <p style={{ color: '#FFB800', fontSize: 11, marginTop: 5 }}>
                  ⚠️ URL sem placeholder ({`{q}`}/{`{query}`}/{`{produto}`}) — a busca por palavra-chave pode não funcionar corretamente.
                </p>
              )}
            </div>
            <div>
              <label className="lbl">Observações</label>
              <input className="inp" placeholder="Notas..." value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="g3">
              <div>
                <label className="lbl">Tipo</label>
                <select className="inp" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Supplier['type'] })}>
                  <option>Nacional</option>
                  <option>Internacional</option>
                </select>
              </div>
              <div>
                <label className="lbl">País</label>
                <select className="inp" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                  <option>Brasil</option><option>China</option><option>EUA</option><option>Alemanha</option><option>Outro</option>
                </select>
              </div>
              <div>
                <label className="lbl">Moeda</label>
                <select className="inp" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Supplier['currency'] })}>
                  <option>BRL</option><option>USD</option><option>EUR</option><option>CNY</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                className={`tog${form.active ? ' on' : ''}`}
                style={{ background: form.active ? '#00D4FF' : '#1C2A3A' }}
                onClick={() => setForm({ ...form, active: !form.active })}
              >
                <div className="tog-dot" />
              </button>
              <span style={{ color: '#8896AA', fontSize: 14 }}>
                Fornecedor {form.active ? 'ativo' : 'inativo'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-p" onClick={saveForm} style={{ flex: 1 }}>
                <Save size={16} color="#fff" /> Salvar
              </button>
              <button className="btn btn-g" onClick={() => setFormMode(null)} style={{ flex: 1 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <p style={{ color: '#4A5568', fontSize: 13 }}>Carregando…</p>}
      {error && <p style={{ color: '#FF4D6D', fontSize: 13 }}>Erro: {error}. Backend rodando?</p>}

      {items.map((s) => (
        <SupplierCard
          key={s.id}
          supplier={s}
          onToggleActive={toggleActive}
          onEdit={openEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

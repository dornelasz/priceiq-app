'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, StoreIcon, HistoryIcon, SettingsIcon, Logo } from './Icons';
import { useEffect, useState } from 'react';
import { ratesApi } from '@/lib/api';
import { fmt4 } from '@/lib/format';

/**
 * Apesar do nome (BottomNav), o nav do PriceIQ original é um TOP nav fixo.
 * Mantemos o nome do arquivo conforme spec, mas o visual é idêntico ao original.
 */

interface Tab {
  href: string;
  label: string;
  matches: (path: string) => boolean;
  Icon: typeof HomeIcon;
}

const TABS: Tab[] = [
  { href: '/',          label: 'Início',    matches: (p) => p === '/',                   Icon: HomeIcon },
  { href: '/suppliers', label: 'Lojas',     matches: (p) => p.startsWith('/suppliers'),  Icon: StoreIcon },
  { href: '/history',   label: 'Histórico', matches: (p) => p.startsWith('/history') || p.startsWith('/results'), Icon: HistoryIcon },
  { href: '/settings',  label: 'Config',    matches: (p) => p.startsWith('/settings'),   Icon: SettingsIcon },
];

export default function BottomNav() {
  const pathname = usePathname() ?? '/';
  const [subText, setSubText] = useState('Comparador com IA');

  useEffect(() => {
    let alive = true;
    async function loadRate() {
      try {
        const r = await ratesApi.current();
        if (!alive) return;
        if (r.usd && r.fetched_at) {
          const t = new Date(r.fetched_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit',
          });
          setSubText(`USD ${fmt4(r.usd)} · ${t}`);
        }
      } catch {
        /* mantém placeholder */
      }
    }
    loadRate();
    const i = setInterval(loadRate, 60_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  return (
    <nav id="nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="logo-box">
          <Logo size={18} />
        </div>
        <div>
          <div className="logo-title">PriceIQ</div>
          <div className="logo-sub">{subText}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {TABS.map(({ href, label, matches, Icon }) => {
          const active = matches(pathname);
          return (
            <Link key={href} href={href} className={`nb${active ? ' on' : ''}`}>
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

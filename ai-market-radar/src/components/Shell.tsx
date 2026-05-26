"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconBell,
  IconClose,
  IconDigest,
  IconGrid,
  IconMenu,
  IconNews,
  IconRadar,
  IconRss,
  IconSettings,
} from "@/components/Icons";
import { CollectNowButton } from "@/components/CollectNowButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: IconGrid },
  { href: "/articles", label: "Notícias", Icon: IconNews },
  { href: "/sources", label: "Fontes", Icon: IconRss },
  { href: "/alerts", label: "Alertas", Icon: IconBell },
  { href: "/digest", label: "Resumo Diário", Icon: IconDigest },
  { href: "/settings", label: "Configurações", Icon: IconSettings },
];

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1">
      <span className="text-brand-soft">
        <IconRadar width={24} height={24} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-white">
        AI Market <span className="text-brand-soft">Radar</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-brand/15 font-medium text-white"
                : "text-zinc-400 hover:bg-bg-hover hover:text-zinc-100"
            }`}
          >
            <Icon width={18} height={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-bg-soft p-3 md:flex">
        <Brand />
        <div className="mt-6 flex-1">
          <NavList />
        </div>
        <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-zinc-600">
          Notícias reais com fonte, URL e data. Sem dados fictícios.
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg-soft/95 px-3 py-2 backdrop-blur md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-zinc-300 hover:bg-bg-hover"
          aria-label="Abrir menu"
        >
          <IconMenu />
        </button>
        <Brand />
        <CollectNowButton compact />
      </header>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-bg-soft p-3">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-zinc-300 hover:bg-bg-hover"
                aria-label="Fechar menu"
              >
                <IconClose />
              </button>
            </div>
            <div className="mt-6">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Main content */}
      <main className="md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

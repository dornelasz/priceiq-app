import type { ReactNode } from "react";
import type { Relevance } from "@prisma/client";
import { RELEVANCE_CLASS, RELEVANCE_LABEL } from "@/lib/format";

export function Pill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`pill border-border bg-bg-soft text-zinc-300 ${className}`}>{children}</span>
  );
}

export function RelevanceBadge({ relevance }: { relevance: Relevance }) {
  return <span className={`pill ${RELEVANCE_CLASS[relevance]}`}>{RELEVANCE_LABEL[relevance]}</span>;
}

export function SectionHeader({
  title,
  icon,
  action,
  description,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
          {icon}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-zinc-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="text-brand-soft">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="text-zinc-600">{icon}</div>
      <div>
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card border-relevance-critical/30 bg-relevance-critical/5 p-6 text-center">
      <p className="text-sm font-medium text-relevance-critical">Algo deu errado</p>
      <p className="mt-1 text-xs text-zinc-400">{message}</p>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

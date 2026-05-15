// Helpers de formatação — porta dos helpers do index.html.

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0.00';
  const num = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

export function fmt4(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0.0000';
  const num = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(num) ? num.toFixed(4) : '0.0000';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

export function rateAge(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'nunca';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s atrás`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min atrás`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h atrás`;
  return `${Math.floor(sec / 86_400)}d atrás`;
}

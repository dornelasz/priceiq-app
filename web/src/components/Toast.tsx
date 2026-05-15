'use client';

import { useEffect, useState } from 'react';

interface ToastEvent {
  msg: string;
  type: 'ok' | 'err';
  id: number;
}

let listeners: Array<(e: ToastEvent) => void> = [];
let counter = 0;

export function showToast(msg: string, type: 'ok' | 'err' = 'ok'): void {
  const ev = { msg, type, id: ++counter };
  listeners.forEach((l) => l(ev));
}

/**
 * Mount uma única instância (no PriceIQShell). Mostra o toast por 2.4s.
 */
export default function Toast() {
  const [current, setCurrent] = useState<ToastEvent | null>(null);

  useEffect(() => {
    const handler = (e: ToastEvent) => {
      setCurrent(e);
      const id = e.id;
      window.setTimeout(() => {
        setCurrent((cur) => (cur && cur.id === id ? null : cur));
      }, 2400);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);

  if (!current) return null;
  return (
    <div id="toast" className={current.type === 'err' ? 'toast-err' : 'toast-ok'}>
      {current.msg}
    </div>
  );
}

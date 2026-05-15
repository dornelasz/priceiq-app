import type { ReactNode } from 'react';
import BottomNav from './BottomNav';
import Toast from './Toast';

/**
 * Shell global do app — nav + container .page + toast singleton.
 * Mantém a estrutura HTML do index.html original (#app > #nav + .page).
 */
export default function PriceIQShell({ children }: { children: ReactNode }) {
  return (
    <div id="app">
      <BottomNav />
      <div className="page">{children}</div>
      <Toast />
    </div>
  );
}

import type { Metadata, Viewport } from 'next';
import PriceIQShell from '@/components/PriceIQShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'PriceIQ',
  description: 'Comparador de preços com cotação ao vivo',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#070B14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <PriceIQShell>{children}</PriceIQShell>
      </body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "AI Market Radar",
  description:
    "Automação de notícias do mercado de Inteligência Artificial: coleta, dedup, análise por IA e resumo diário — sempre com fonte, URL e data reais.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-bg text-zinc-200 antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

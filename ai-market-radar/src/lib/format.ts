import type { ArticleType, Relevance, SourceType } from "@prisma/client";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(value?: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(value?: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function timeAgo(value?: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `há ${days} d`;
  return formatDate(d);
}

export const RELEVANCE_LABEL: Record<Relevance, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const RELEVANCE_CLASS: Record<Relevance, string> = {
  LOW: "bg-relevance-low/15 text-relevance-low border-relevance-low/30",
  MEDIUM: "bg-relevance-medium/15 text-relevance-medium border-relevance-medium/30",
  HIGH: "bg-relevance-high/15 text-relevance-high border-relevance-high/30",
  CRITICAL: "bg-relevance-critical/15 text-relevance-critical border-relevance-critical/30",
};

export const ARTICLE_TYPE_LABEL: Record<ArticleType, string> = {
  NEWS: "Notícia",
  LAUNCH: "Lançamento",
  RESEARCH: "Pesquisa",
  TOOL: "Ferramenta",
  INVESTMENT: "Investimento",
  REGULATION: "Regulação",
  PRODUCT_UPDATE: "Atualização de produto",
  TREND: "Tendência",
  OPINION: "Opinião",
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  RSS: "RSS",
  BLOG: "Blog oficial",
  SITE: "Site",
  PAPER: "Paper",
  GITHUB: "GitHub",
  PRODUCT_LAUNCH: "Product Launch",
  OTHER: "Outro",
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

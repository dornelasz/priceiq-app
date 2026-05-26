// Universal shape every collector returns, regardless of source type.
export interface CollectedItem {
  title: string;
  url: string;
  publishedAt: Date | null;
  excerpt: string | null;
  content: string | null;
  sourceName: string;
  author: string | null;
  language: string | null;
}

export interface CollectorResult {
  items: CollectedItem[];
  // Non-fatal notices (e.g. "collector not implemented"). These do NOT count
  // as a source failure — they just inform the operator.
  warnings: string[];
}

export interface CollectorInput {
  url: string;
  sourceName: string;
  signal?: AbortSignal;
}

export function toDateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function cleanText(value?: string | null, max = 8000): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

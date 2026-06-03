/**
 * Extração de candidatos a produto a partir da página de busca.
 *
 * Implementação independente de scrapers antigos — usa as mesmas regras
 * regex que o productPageDetector da Fase C, mas auto-contida no
 * Recipe Runner para evitar acoplamento entre módulos V2 distintos.
 *
 * Função PURA.
 */

export interface CandidateUrl {
  url: string;
  text?: string;
  confidence: number;
  reason: string;
}

const POSITIVE_PATTERNS: Array<{ rx: RegExp; score: number; reason: string }> = [
  { rx: /\/dp\/[A-Z0-9]+/i, score: 80, reason: 'amazon-dp' },
  { rx: /MLB-?\d{6,}/i, score: 80, reason: 'mercadolivre-id' },
  { rx: /MLU-?\d{6,}/i, score: 80, reason: 'mercadolivre-uy-id' },
  { rx: /\/i\.\d+\.\d+/i, score: 70, reason: 'shopee-id' },
  { rx: /\/products?\//i, score: 65, reason: 'products-path' },
  { rx: /\/produtos?\//i, score: 65, reason: 'produtos-path' },
  { rx: /\/p\/[a-z0-9][^/]*\/?$/i, score: 55, reason: 'short-p-path' },
  { rx: /\/item\/[a-z0-9]/i, score: 55, reason: 'item-path' },
  { rx: /\/sku\//i, score: 55, reason: 'sku-path' },
];

const NEGATIVE_PATTERNS: RegExp[] = [
  /\/cart(\/|$)/i,
  /\/carrinho(\/|$)/i,
  /\/checkout(\/|$)/i,
  /\/finalizar/i,
  /\/login/i,
  /\/account/i,
  /\/conta\//i,
  /\/category\//i,
  /\/categoria\//i,
  /\/categories\//i,
  /\/collections?\//i,
  /\/help/i,
  /\/about/i,
  /\/sobre/i,
  /\/contact/i,
  /\/contato/i,
  /\/privacy/i,
  /\/termos/i,
  /\/wishlist/i,
  /\/favoritos/i,
  /\/blog\//i,
  /\/page\//i,
  /\/search/i,
  /\/busca/i,
  /\.(?:png|jpe?g|gif|webp|svg|css|js)(?:\?|$)/i,
];

export interface ExtractCandidatesInput {
  searchPageHtml: string;
  searchPageUrl: string;
  baseUrl?: string;
  maxCandidates?: number;
  contentType?: 'html' | 'markdown';
}

export interface ExtractCandidatesResult {
  candidates: CandidateUrl[];
}

function extractFromHtml(
  html: string,
  searchPageUrl: string,
  map: Map<string, CandidateUrl>,
): void {
  const linkRx = /<a\b[^>]*href=["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRx.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
    const text = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    let abs: string;
    try {
      abs = new URL(raw, searchPageUrl).toString();
    } catch {
      continue;
    }

    scoreAndAdd(abs, text, map);
  }
}

function extractFromMarkdown(
  md: string,
  searchPageUrl: string,
  map: Map<string, CandidateUrl>,
): void {
  const mdLinkRx = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = mdLinkRx.exec(md)) !== null) {
    const text = (m[1] ?? '').trim();
    const raw = (m[2] ?? '').trim();
    if (!raw || raw.startsWith('#')) continue;

    let abs: string;
    try {
      abs = /^https?:\/\//i.test(raw) ? raw : new URL(raw, searchPageUrl).toString();
    } catch {
      continue;
    }

    scoreAndAdd(abs, text, map);
  }
}

function scoreAndAdd(abs: string, text: string, map: Map<string, CandidateUrl>): void {
  if (NEGATIVE_PATTERNS.some((p) => p.test(abs))) return;

  for (const pat of POSITIVE_PATTERNS) {
    if (pat.rx.test(abs)) {
      const existing = map.get(abs);
      if (!existing || existing.confidence < pat.score) {
        map.set(abs, {
          url: abs,
          text: text || undefined,
          confidence: pat.score,
          reason: pat.reason,
        });
      }
      return;
    }
  }

  // URLs sem match em POSITIVE_PATTERNS mas que parecem ser de produto
  // (têm path com slug longo e não são negativas) — confiança baixa
  try {
    const u = new URL(abs);
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && pathParts.some((p) => p.length > 10)) {
      const existing = map.get(abs);
      if (!existing) {
        map.set(abs, {
          url: abs,
          text: text || undefined,
          confidence: 30,
          reason: 'long-slug',
        });
      }
    }
  } catch { /* ignore */ }
}

export function extractCandidates(
  input: ExtractCandidatesInput,
): ExtractCandidatesResult {
  const max = input.maxCandidates ?? 5;
  const map = new Map<string, CandidateUrl>();
  const content = input.searchPageHtml;
  const isMarkdown = input.contentType === 'markdown';

  if (isMarkdown) {
    extractFromMarkdown(content, input.searchPageUrl, map);
  } else {
    extractFromHtml(content, input.searchPageUrl, map);
  }

  return {
    candidates: Array.from(map.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max),
  };
}

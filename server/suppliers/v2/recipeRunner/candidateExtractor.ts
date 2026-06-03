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
}

export interface ExtractCandidatesResult {
  candidates: CandidateUrl[];
}

export function extractCandidates(
  input: ExtractCandidatesInput,
): ExtractCandidatesResult {
  const max = input.maxCandidates ?? 5;
  const map = new Map<string, CandidateUrl>();
  const linkRx = /<a\b[^>]*href=["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRx.exec(input.searchPageHtml)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
    const text = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    let abs: string;
    try {
      abs = new URL(raw, input.searchPageUrl).toString();
    } catch {
      continue;
    }

    if (NEGATIVE_PATTERNS.some((p) => p.test(abs))) continue;

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
        break;
      }
    }
  }

  return {
    candidates: Array.from(map.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max),
  };
}

/**
 * Extrator de produtos a partir de texto markdown (Jina/Firecrawl).
 *
 * Markdown não tem DOM — busca preços por regex e nomes de produto
 * por contexto (cabeçalhos, linhas de texto próximas ao preço, links).
 *
 * Confiança: 60 (acima de DOM, abaixo de JSON-LD/meta tags).
 * Função PURA.
 */
import type { ExtractedProductData } from './types.js';

const INSTALLMENT_RX = /\b(?:\d+x\s+de|parcela|installment|mensal|monthly|por\s+mês)\b/i;

const PRICE_PATTERNS: Array<{ rx: RegExp; currency: string }> = [
  { rx: /R\$\s*([\d.]+,\d{2}|\d+(?:[.,]\d{2})?|\d+)/i, currency: 'BRL' },
  { rx: /US\$\s*([\d,]+(?:\.\d{2})?)/i, currency: 'USD' },
  { rx: /€\s*([\d.]+,\d{2}|\d+(?:[.,]\d{2})?|\d+)/i, currency: 'EUR' },
  { rx: /¥\s*([\d,]+(?:\.\d{2})?)/i, currency: 'CNY' },
  { rx: /\$\s*([\d,]+\.\d{2})/i, currency: 'USD' },
];

function parseLocalizedNumber(raw: string, currency: string): number | undefined {
  let s = raw.trim();
  if (currency === 'BRL' || currency === 'EUR') {
    if (/,\d{2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function findNearestHeading(lines: string[], lineIdx: number): string | null {
  for (let i = lineIdx; i >= 0; i--) {
    const line = lines[i]!.trim();
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch && headingMatch[1]) {
      const text = headingMatch[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
      if (text.length >= 3 && text.length < 300) return text;
    }
  }
  return null;
}

function findProductNameNearPrice(lines: string[], lineIdx: number): string | null {
  // heading above
  const heading = findNearestHeading(lines, lineIdx);
  if (heading) return heading;

  // bold text in surrounding lines
  for (let offset = -3; offset <= 0; offset++) {
    const idx = lineIdx + offset;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx]!;
    const bold = line.match(/\*\*(.{3,100})\*\*/);
    if (bold && bold[1]) return bold[1].trim();
  }

  // link text in surrounding lines
  for (let offset = -3; offset <= 0; offset++) {
    const idx = lineIdx + offset;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx]!;
    const link = line.match(/\[([^\]]{3,100})\]\(/);
    if (link && link[1]) return link[1].trim();
  }

  return null;
}

export function extractFromMarkdown(
  markdown: string,
  productUrl: string,
): ExtractedProductData | null {
  if (!markdown || markdown.length < 30) return null;

  const lines = markdown.split('\n');
  let bestResult: ExtractedProductData | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (INSTALLMENT_RX.test(line)) continue;

    for (const pat of PRICE_PATTERNS) {
      const m = line.match(pat.rx);
      if (!m || !m[1]) continue;

      const price = parseLocalizedNumber(m[1], pat.currency);
      if (price === undefined) continue;

      const name = findProductNameNearPrice(lines, i);
      if (!name) continue;

      const idx = m.index ?? 0;
      const evidenceStart = Math.max(0, idx - 40);
      const evidenceEnd = Math.min(line.length, idx + (m[0]?.length ?? 0) + 40);
      const evidenceText = `markdown · "${name}" · trecho="${line.slice(evidenceStart, evidenceEnd).trim()}"`;

      const confidence = 60;

      if (!bestResult || confidence > bestResult.confidence) {
        bestResult = {
          strategy: 'jina_fallback',
          productName: name,
          price,
          currency: pat.currency,
          productUrl,
          evidenceText,
          confidence,
        };
      }

      break;
    }
  }

  if (bestResult) return bestResult;

  // fallback: just a name
  const heading = findNearestHeading(lines, Math.min(lines.length - 1, 10));
  if (heading) {
    return {
      strategy: 'jina_fallback',
      productName: heading,
      productUrl,
      evidenceText: `markdown · heading="${heading}" · preço não localizado`,
      confidence: 15,
    };
  }

  return null;
}

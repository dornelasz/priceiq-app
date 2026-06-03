/**
 * Extractor de fallback puramente baseado em DOM/regex.
 *
 * Usa h1/title como nome do produto e tenta achar preço textual no HTML
 * próximo do nome. Confiança baixa por construção — nunca aceita preço
 * solto sem nome de produto.
 *
 * Função PURA — não toca rede ou DB.
 */
import type { ExtractedProductData } from './types.js';

const PRICE_PATTERNS: Array<{ rx: RegExp; currency: string }> = [
  // R$ 1.234,56 / R$ 1234,56 / R$ 99
  { rx: /R\$\s*([\d.]+,\d{2}|\d+(?:[.,]\d{2})?|\d+)/i, currency: 'BRL' },
  // US$ 999.99 / US$ 999
  { rx: /US\$\s*([\d,]+(?:\.\d{2})?)/i, currency: 'USD' },
  // $ 999.99 — assume USD se não houver R$/US$
  { rx: /\$\s*([\d,]+(?:\.\d{2})?)/i, currency: 'USD' },
  // €1.234,56
  { rx: /€\s*([\d.]+,\d{2}|\d+(?:[.,]\d{2})?|\d+)/i, currency: 'EUR' },
];

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseLocalizedNumber(raw: string, currency: string): number | undefined {
  let s = raw.trim();
  if (currency === 'BRL' || currency === 'EUR') {
    // Estilo BR/EU: '.' milhar, ',' decimal
    if (/,\d{2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else {
    // Estilo US: ',' milhar, '.' decimal
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function findPriceWithEvidence(
  html: string,
): { price: number; currency: string; evidence: string } | null {
  const text = stripTags(html);
  for (const pat of PRICE_PATTERNS) {
    const m = text.match(pat.rx);
    if (m && m[1]) {
      const price = parseLocalizedNumber(m[1], pat.currency);
      if (price === undefined) continue;
      // Captura ±80 chars como evidência
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + (m[0]?.length ?? 0) + 60);
      const evidence = text.slice(start, end).trim();
      return { price, currency: pat.currency, evidence };
    }
  }
  return null;
}

function pickProductName(html: string): string | undefined {
  // Prefere <h1>...</h1>
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1 && h1[1]) {
    const n = stripTags(h1[1]);
    if (n.length >= 3 && n.length < 300) return n;
  }
  // Tenta <title>
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title && title[1]) {
    const n = stripTags(title[1]);
    if (n.length >= 3 && n.length < 300) return n;
  }
  return undefined;
}

export function extractFromDom(
  html: string,
  productUrl: string,
): ExtractedProductData | null {
  const name = pickProductName(html);
  if (!name) return null; // sem nome → não aceita preço solto

  const priceInfo = findPriceWithEvidence(html);
  if (!priceInfo) {
    // tem nome mas sem preço — retorna parcial com confiança baixa
    return {
      strategy: 'dom',
      productName: name,
      productUrl,
      evidenceText: `DOM h1/title="${name}" · preço não localizado`,
      confidence: 20,
    };
  }

  const evidenceText = `DOM · "${name}" · trecho="${priceInfo.evidence}"`;
  return {
    strategy: 'dom',
    productName: name,
    price: priceInfo.price,
    currency: priceInfo.currency,
    productUrl,
    evidenceText,
    confidence: 45,
  };
}

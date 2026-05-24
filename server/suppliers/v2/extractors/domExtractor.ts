/**
 * Extractor de fallback baseado em DOM/texto.
 *
 * Usa h1/title como nome do produto e o ranker de candidatos de preço para
 * achar o PREÇO PRINCIPAL (descartando parcela/frete/desconto), em vez de
 * pegar o primeiro número. Confiança baixa por construção — nunca aceita
 * preço solto sem nome de produto.
 *
 * Função PURA — não toca rede ou DB.
 */
import type { ExtractedProductData } from './types.js';
import { pickPrincipalPrice } from './priceCandidates.js';

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function findPriceWithEvidence(
  html: string,
): { price: number; currency: string; evidence: string } | null {
  const text = stripTags(html);
  const best = pickPrincipalPrice(text, { source: 'dom', minConfidence: 1 });
  if (!best) return null;
  const idx = text.indexOf(best.rawText);
  const start = Math.max(0, (idx >= 0 ? idx : 0) - 60);
  const end = Math.min(text.length, (idx >= 0 ? idx : 0) + best.rawText.length + 60);
  return {
    price: best.value,
    currency: best.currency,
    evidence: text.slice(start, end).trim(),
  };
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

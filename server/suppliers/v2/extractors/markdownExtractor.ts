/**
 * Extrator de markdown / texto limpo (estilo Jina Reader) — NÃO faz fetch.
 *
 * Recebe texto já coletado e tenta achar o preço principal (via ranker de
 * candidatos) e o nome do produto na vizinhança do preço, usando os tokens da
 * query para ancorar. Última camada antes do regex solto.
 *
 * Função PURA — não toca rede, DB nem IA.
 */
import type { ExtractedProductData } from './types.js';
import {
  pickPrincipalPrice,
  type PriceCandidate,
} from './priceCandidates.js';
import type { SupportedCurrency } from './moneyParser.js';

function cleanLine(raw: string): string {
  return raw
    .replace(/^[#*\-\s|>]+/, '')
    .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableNameLine(cleaned: string): boolean {
  if (cleaned.length < 6 || cleaned.length > 240) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (/^(ver|comprar|adicionar|mais|detalhes?|produto|imagem|frete|envio)\b/i.test(cleaned)) {
    return false;
  }
  if (/^(R\$|US\$|USD|EUR|€|¥|CNY|RMB)\s*[\d.,]+/i.test(cleaned)) return false;
  return true;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Procura o nome do produto NA VIZINHANÇA do preço (janela antes da posição),
 * exigindo sobreposição com os tokens da query. Evita pegar linha de preço/link.
 */
function findProductNameNear(
  content: string,
  approxIndex: number,
  query: string,
): string | null {
  const qTokens = normalize(query).split(' ').filter((t) => t.length >= 2);
  if (qTokens.length === 0) return null;

  const start = Math.max(0, approxIndex - 600);
  const slice = content.slice(start, approxIndex + 80);
  const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const cleaned = cleanLine(lines[i] ?? '');
    if (!isUsableNameLine(cleaned)) continue;
    const lineNorm = normalize(cleaned);
    const matched = qTokens.filter((t) => lineNorm.includes(t)).length;
    if (matched >= Math.ceil(qTokens.length / 2)) {
      return cleaned.slice(0, 200);
    }
  }
  return null;
}

export interface MarkdownExtractInput {
  markdown: string;
  productUrl: string;
  query: string;
  expectedCurrency?: SupportedCurrency;
}

export function extractFromMarkdown(
  input: MarkdownExtractInput,
): ExtractedProductData | null {
  const { markdown, productUrl, query } = input;
  if (!markdown || markdown.length < 20) return null;

  const principal: PriceCandidate | null = pickPrincipalPrice(markdown, {
    expectedCurrency: input.expectedCurrency,
    source: 'markdown',
  });
  if (!principal) return null;

  const idx = markdown.indexOf(principal.rawText);
  const name = findProductNameNear(markdown, idx >= 0 ? idx : 0, query);
  if (!name) return null; // sem nome âncora → não valida preço solto

  const evStart = Math.max(0, (idx >= 0 ? idx : 0) - 100);
  const evEnd = Math.min(markdown.length, (idx >= 0 ? idx : 0) + 100);
  const evidenceText = `markdown · "${name}" · ${markdown
    .slice(evStart, evEnd)
    .replace(/\s+/g, ' ')
    .trim()}`;

  return {
    strategy: 'visual_heuristic',
    productName: name,
    price: principal.value,
    currency: principal.currency,
    productUrl,
    evidenceText,
    confidence: Math.min(70, 30 + Math.round(principal.confidence / 3)),
  };
}

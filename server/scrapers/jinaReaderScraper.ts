/**
 * Scraper genérico baseado em Jina Reader (https://r.jina.ai) + Gemini.
 *
 * Fluxo:
 *  1. Constrói URL de busca a partir do search_url_template do fornecedor
 *  2. Busca conteúdo via Jina Reader (HTML → markdown)
 *  3. Pede ao Gemini para extrair JSON estruturado (interpretador)
 *  4. Pós-processa para garantir link direto de produto
 *
 * Falhas individuais NÃO derrubam outros fornecedores (caller usa concorrência).
 *
 * Este arquivo expõe a função `scrapeViaJinaReader` (usada quando nenhum scraper
 * específico está disponível) E a função reutilizável `extractViaJinaAndGemini`
 * (usada pelos scrapers específicos depois de construir uma URL).
 */
import { callGemini, isQuotaError, parseJsonFromGemini } from '../lib/gemini.js';
import { TimeoutError } from '../lib/errors.js';
import type { Supplier } from '../services/supplierService.js';
import { matchingService } from '../services/matchingService.js';

export interface ScrapedResult {
  found: boolean;
  productName?: string;
  price?: number;
  currency?: string;
  link?: string;
  linkType?: 'product' | 'search';
  sellerName?: string;
  freight?: number;
  available?: boolean;
  warning?: string;
  confidence?: number;
  matchScore?: number;
  errorMessage?: string;
  rawData?: unknown;
  quotaExceeded?: boolean;
}

export interface ScrapeOptions {
  timeoutMs: number;
}

const PRODUCT_URL_PATTERNS: RegExp[] = [
  /\/MLB\d{5,}/,                    // Mercado Livre
  /\/dp\/[A-Z0-9]{8,}/,             // Amazon
  /-i\.\d{5,}\.\d{5,}/,             // Shopee
  /\/p\/[a-z0-9]{8,}[\/.]/,         // Magalu
  /\/item\/\d{8,}/,                 // AliExpress
  /\/product[-_]detail\//i,         // Alibaba
];

export function isProductUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  return PRODUCT_URL_PATTERNS.some((p) => p.test(url));
}

function findDirectUrl(content: string, siteHost: string): string | null {
  if (!content || !siteHost) return null;
  // 1) padrões conhecidos de produto
  for (const p of PRODUCT_URL_PATTERNS) {
    const full = new RegExp(`https?:\\/\\/[^\\s)"'<>]*${p.source}[^\\s)"'<>]*`, 'i');
    const m = content.match(full);
    if (m) return m[0].replace(/[).,;:!?]+$/, '');
  }
  // 2) primeira URL interna do domínio que não seja a busca
  const escSite = siteHost.replace(/\./g, '\\.');
  const rx = new RegExp(`https?:\\/\\/(?:www\\.)?${escSite}\\/[^\\s)"'<>]{4,}`, 'gi');
  const matches = content.match(rx) ?? [];
  for (const u of matches) {
    const clean = u.replace(/[).,;:!?]+$/, '');
    if (/\/(search|busca|s\?|find|q=)/i.test(clean)) continue;
    return clean;
  }
  return null;
}

export async function fetchViaJina(url: string, timeoutMs: number): Promise<string> {
  const endpoint = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(endpoint, {
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'text',
        'X-Timeout': '15',
        'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)',
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Jina HTTP ${r.status}`);
    const txt = await r.text();
    return txt.slice(0, 8000);
  } finally {
    clearTimeout(timer);
  }
}

export function buildDefaultSearchUrl(supplier: Supplier, query: string): string {
  if (supplier.search_url_template && supplier.search_url_template.includes('{q}')) {
    return supplier.search_url_template.replace('{q}', encodeURIComponent(query));
  }
  const host = supplier.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/search?q=${encodeURIComponent(query)}`;
}

/**
 * Função reutilizável: dada uma URL já construída e o fornecedor/query,
 * busca conteúdo via Jina, manda para o Gemini e retorna o resultado tipado.
 *
 * Esta é a "engine" usada por TODOS os scrapers (específicos e genérico).
 */
export async function extractViaJinaAndGemini(
  supplier: Supplier,
  query: string,
  searchUrl: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const siteNoWww = supplier.site.replace(/^www\./, '').toLowerCase();
  const jsonTpl = `{"found":true,"productName":"nome real","price":0.00,"currency":"${supplier.currency}","link":"url","sellerName":"","freight":0.00,"available":true,"warning":"","confidence":80}`;

  const deadline = Date.now() + opts.timeoutMs;

  // ─── 1. Buscar conteúdo via Jina ───
  let pageContent: string;
  try {
    pageContent = await fetchViaJina(searchUrl, Math.min(15_000, deadline - Date.now()));
  } catch (e) {
    return { found: false, errorMessage: `Jina(busca): ${(e as Error).message}` };
  }

  if (!pageContent || pageContent.length < 300) {
    return { found: false, errorMessage: 'conteúdo da página vazio/curto demais' };
  }

  if (Date.now() > deadline) {
    throw new TimeoutError(`Tempo esgotado para ${supplier.name}`);
  }

  // ─── 2. Gemini como interpretador final ───
  const prompt = `Você é um extrator de e-commerce. Analise a página de busca real do ${supplier.name} (${supplier.site}) e retorne o melhor produto para "${query}".

CONTEÚDO:
---
${pageContent.slice(0, 7000)}
---

REGRAS ABSOLUTAS:
1. NÃO retorne acessórios/capas/cabos/películas a menos que o usuário pediu na query.
2. Se múltiplos: escolha menor preço + melhor avaliação.
3. Extraia SOMENTE dados visíveis no texto. JAMAIS invente preço, nome ou link.
4. Se NÃO encontrar preço REAL E EXPLÍCITO no conteúdo: {"found":false,"reason":"preço não encontrado"}
5. Para "link": procure URL completa começando com http(s):// que contenha "${siteNoWww}" e que NÃO seja a página de busca/categoria.
   Padrões: /MLB, /dp/, -i., /p/, /item/, /product-detail/, /produto/, /products/, /pd/, /pdp/.
   Se não encontrar URL específica, use: "${searchUrl}"
6. "confidence" deve refletir SUA confiança na extração: 90+ se nome+preço+link estão claros, 60-80 se algum dado está incerto.

RETORNE APENAS este JSON:
${jsonTpl}`;

  try {
    const raw = await callGemini({
      prompt,
      maxTokens: 1000,
      useSearch: false,
      timeoutMs: Math.max(5_000, deadline - Date.now()),
    });
    const parsed = parseJsonFromGemini(raw);
    if (!parsed) {
      return { found: false, errorMessage: 'Gemini retornou JSON inválido' };
    }
    if (parsed['found'] === false) {
      return {
        found: false,
        errorMessage: typeof parsed['reason'] === 'string' ? parsed['reason'] : 'produto não encontrado',
      };
    }

    // Pós-processamento: link direto de produto
    let link = String(parsed['link'] ?? '');
    if (!isProductUrl(link)) {
      const direct = findDirectUrl(pageContent, siteNoWww);
      if (direct && (direct.includes(siteNoWww) || direct.includes(supplier.site))) {
        link = direct;
      }
    }
    if (!link || !link.startsWith('http')) link = searchUrl;

    // ─── REGRA-OURO: nunca inventar preço ───
    const price = Number(parsed['price'] ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      return { found: false, errorMessage: 'preço inválido — não encontrado com segurança', rawData: parsed };
    }

    const productName = String(parsed['productName'] ?? '').slice(0, 200) || query;
    const warning = String(parsed['warning'] ?? '').trim();

    // matching score calculado em JS (independente do Gemini)
    const matchResult = matchingService.score(query, productName);
    let combinedWarning = warning || undefined;
    if (matchResult.isLikelyAccessory) {
      combinedWarning = (combinedWarning ? combinedWarning + ' · ' : '') + 'Possível acessório, não o produto principal';
    } else if (matchResult.score < 50) {
      combinedWarning = (combinedWarning ? combinedWarning + ' · ' : '') + `Match baixo (${matchResult.score}%) — confira se é o produto certo`;
    }

    return {
      found: true,
      productName,
      price,
      currency: String(parsed['currency'] ?? supplier.currency).toUpperCase(),
      link,
      linkType: isProductUrl(link) ? 'product' : 'search',
      sellerName: String(parsed['sellerName'] ?? '').slice(0, 200) || undefined,
      freight: Number(parsed['freight']) || 0,
      available: parsed['available'] === false ? false : true,
      warning: combinedWarning,
      matchScore: matchResult.score,
      confidence: Number(parsed['confidence']) || 75,
      rawData: parsed,
    };
  } catch (e) {
    const quota = isQuotaError(e);
    return {
      found: false,
      errorMessage: `Gemini: ${(e as Error).message}`,
      quotaExceeded: quota,
    };
  }
}

/**
 * Scraper genérico (Jina + Gemini) usando a URL padrão do fornecedor.
 * Usado como fallback quando não há scraper específico.
 */
export async function scrapeViaJinaReader(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildDefaultSearchUrl(supplier, query);
  return extractViaJinaAndGemini(supplier, query, searchUrl, opts);
}

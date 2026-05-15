/**
 * Scraper genérico baseado em Jina Reader.
 *
 * ARQUITETURA (pós-fix anti-fantasma + anti-quota-Gemini):
 *
 *   1. Busca conteúdo via Jina Reader (HTML → markdown)
 *   2. EXTRAÇÃO DIRETA via regex/heurísticas (directExtractor) — SEM IA
 *      → Esta é a fonte PRIMÁRIA de preço/produto/URL.
 *   3. Se extração direta falhou E GEMINI_ENABLED=true:
 *      → Tenta Gemini como interpretador OPCIONAL do conteúdo.
 *      → Gemini NUNCA vê a query sem o conteúdo Jina.
 *      → Erro de quota/429 vira warning interno, NÃO bloqueia a busca.
 *   4. Resultado passa por validateProductUrl (anti produto-fantasma).
 *
 * Garantias:
 *   - Se Gemini está desligado/sem quota, a busca continua (usa só extração direta).
 *   - Toda URL é validada estrutural + semanticamente (precisa aparecer na fonte).
 *   - Preço inválido OU URL inventada → resultado rejeitado (error_message).
 */
import { config } from '../config.js';
import { callGemini, isQuotaError, parseJsonFromGemini } from '../lib/gemini.js';
import { TimeoutError } from '../lib/errors.js';
import type { Supplier } from '../services/supplierService.js';
import { matchingService } from '../services/matchingService.js';
import { validateProductUrl } from '../services/urlValidator.js';
import { extractDirectly, type DirectExtractResult } from './directExtractor.js';

export interface ScrapedResult {
  found: boolean;
  productName?: string;
  price?: number;
  currency?: string;
  link?: string;
  linkType?: 'product' | 'search' | 'unverified';
  linkValidated?: boolean;
  sellerName?: string;
  freight?: number;
  available?: boolean;
  warning?: string;
  validationWarning?: string;
  confidence?: number;
  matchScore?: number;
  errorMessage?: string;
  evidenceText?: string;
  sourceUrl?: string;
  sourceName?: string;
  rawData?: unknown;
  /** Indica que Gemini falhou por quota — usado para warning discreto na UI */
  geminiUnavailable?: boolean;
}

export interface ScrapeOptions {
  timeoutMs: number;
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
    if (!r.ok) {
      // Status específicos: 403/429/451 → bloqueio do fornecedor (não erro nosso)
      const status = r.status;
      if (status === 403 || status === 429 || status === 451) {
        const e = new Error(`Fornecedor bloqueou leitura via Jina (HTTP ${status}); fallback necessário`);
        (e as Error & { jinaBlocked?: boolean }).jinaBlocked = true;
        throw e;
      }
      throw new Error(`Jina HTTP ${status}`);
    }
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
 * Tenta extrair via Gemini APENAS como interpretador do conteúdo Jina já coletado.
 * NUNCA é a fonte primária. NUNCA vê só a query — sempre vê o conteúdo real.
 * Falhas de quota são SILENCIOSAS (warning interno, não erro fatal).
 */
async function tryGeminiInterpreter(
  supplier: Supplier,
  query: string,
  pageContent: string,
  searchUrl: string,
  timeoutMs: number,
): Promise<DirectExtractResult & { geminiUnavailable?: boolean }> {
  // Gate de feature flag — se desligado, nem tenta
  if (!config.GEMINI_ENABLED || !config.GEMINI_API_KEY) {
    return {
      found: false,
      errorMessage: 'Gemini desligado (extração direta não encontrou resultado seguro)',
      sourceUrl: searchUrl,
      sourceName: 'no-ai',
    };
  }

  const siteNoWww = supplier.site.replace(/^www\./, '').toLowerCase();
  const jsonTpl = `{"found":true,"productName":"nome real","price":0.00,"currency":"${supplier.currency}","link":"url","sellerName":"","freight":0.00,"available":true,"evidenceText":"trecho onde achou","confidence":80}`;

  const prompt = `Você é APENAS um INTERPRETADOR. NÃO pesquise. NÃO invente nada.
Use SOMENTE o conteúdo fornecido abaixo (já coletado por scraper) para extrair o produto que casa com a query do usuário.

QUERY: "${query}"
FORNECEDOR: ${supplier.name} (${supplier.site})

CONTEÚDO COLETADO (truncado em 7000 chars):
---
${pageContent.slice(0, 7000)}
---

REGRAS ABSOLUTAS:
1. SOMENTE dados que estão LITERALMENTE no conteúdo. JAMAIS invente preço/nome/link.
2. NÃO retorne acessórios (capa/película/cabo) salvo se a query pedir.
3. "link" precisa ser uma URL que APARECE no conteúdo, com domínio "${siteNoWww}".
   Se não houver URL de produto específica visível, retorne "${searchUrl}".
4. "evidenceText" precisa ser um trecho EXATO do conteúdo onde você viu o preço (60-200 chars).
5. Se NÃO encontrar preço REAL e EXPLÍCITO no conteúdo, retorne {"found":false,"reason":"motivo"}.

RETORNE APENAS este JSON:
${jsonTpl}`;

  try {
    const raw = await callGemini({ prompt, maxTokens: 1000, useSearch: false, timeoutMs });
    const parsed = parseJsonFromGemini(raw);
    if (!parsed) {
      return {
        found: false,
        errorMessage: 'Gemini retornou JSON inválido',
        sourceUrl: searchUrl,
        sourceName: 'gemini-interpreter',
      };
    }
    if (parsed['found'] === false) {
      return {
        found: false,
        errorMessage: typeof parsed['reason'] === 'string' ? parsed['reason'] : 'Gemini não encontrou produto',
        sourceUrl: searchUrl,
        sourceName: 'gemini-interpreter',
      };
    }
    const price = Number(parsed['price'] ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        found: false,
        errorMessage: 'Gemini retornou preço inválido',
        sourceUrl: searchUrl,
        sourceName: 'gemini-interpreter',
      };
    }
    const name = String(parsed['productName'] ?? '').slice(0, 200) || query;
    const match = matchingService.score(query, name);
    return {
      found: true,
      productName: name,
      price,
      currency: String(parsed['currency'] ?? supplier.currency).toUpperCase(),
      link: String(parsed['link'] ?? '') || undefined,
      sellerName: String(parsed['sellerName'] ?? '') || undefined,
      freight: Number(parsed['freight']) || 0,
      available: parsed['available'] === false ? false : true,
      evidenceText: String(parsed['evidenceText'] ?? '').slice(0, 500) || undefined,
      sourceUrl: searchUrl,
      sourceName: 'gemini-interpreter',
      matchScore: match.score,
      confidence: Number(parsed['confidence']) || 60,
    };
  } catch (e) {
    if (isQuotaError(e)) {
      // ⚠️ Quota Gemini esgotada — NÃO é falha global, é warning discreto.
      return {
        found: false,
        errorMessage: 'Interpretação por IA indisponível (quota)',
        sourceUrl: searchUrl,
        sourceName: 'gemini-interpreter',
        geminiUnavailable: true,
      };
    }
    return {
      found: false,
      errorMessage: `Gemini: ${(e as Error).message}`,
      sourceUrl: searchUrl,
      sourceName: 'gemini-interpreter',
    };
  }
}

/**
 * Engine reutilizável: dado um conteúdo Jina, faz extração DIRETA + Gemini opcional + validação.
 */
async function processJinaContent(
  supplier: Supplier,
  query: string,
  searchUrl: string,
  content: string,
  deadline: number,
): Promise<ScrapedResult> {
  // ─── 1. Extração DIRETA (sem IA) — fonte primária ───
  const directResult = extractDirectly(supplier, query, content, searchUrl);

  // ─── 2. Se direta falhou, tenta Gemini como interpretador OPCIONAL ───
  let result: DirectExtractResult & { geminiUnavailable?: boolean } = directResult;
  let geminiUnavailable = false;
  if (!directResult.found && config.GEMINI_ENABLED && config.GEMINI_API_KEY) {
    const remaining = Math.max(5_000, deadline - Date.now());
    const geminiResult = await tryGeminiInterpreter(supplier, query, content, searchUrl, remaining);
    if (geminiResult.geminiUnavailable) geminiUnavailable = true;
    if (geminiResult.found) {
      result = geminiResult;
    }
    // Se Gemini falhou também, mantém o erro do directResult (mais informativo geralmente)
  }

  // ─── 3. Sem resultado válido → retorna erro ───
  if (!result.found || !result.price || result.price <= 0 || !result.productName) {
    return {
      found: false,
      errorMessage: result.errorMessage ?? 'preço não encontrado com segurança',
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? 'jina-direct',
      geminiUnavailable: geminiUnavailable || undefined,
    };
  }

  // ─── 4. Validação obrigatória de match_score ───
  if (result.matchScore !== undefined && result.matchScore < config.MIN_MATCH_SCORE) {
    return {
      found: false,
      errorMessage: `Produto encontrado com match baixo (${result.matchScore}%) — rejeitado para evitar produto fantasma`,
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? 'jina-direct',
      geminiUnavailable: geminiUnavailable || undefined,
    };
  }

  // ─── 5. Validação OBRIGATÓRIA do link (anti produto fantasma) ───
  const linkValidation = validateProductUrl(result.link, supplier, content, searchUrl);

  // Se o linkValidator rejeitou totalmente E não há nem URL de busca, rejeita o resultado
  if (!linkValidation.link) {
    return {
      found: false,
      errorMessage: 'Produto encontrado sem link direto validado nem URL de busca — rejeitado para evitar produto fantasma',
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? 'jina-direct',
      evidenceText: result.evidenceText,
      geminiUnavailable: geminiUnavailable || undefined,
    };
  }

  // Confiança reduzida se link não validado
  let confidence = result.confidence ?? 70;
  if (!linkValidation.validated) confidence = Math.min(confidence, 50);

  // Compõe warning combinando: extração direta, validação de link, match
  const warnings: string[] = [];
  if (result.warning) warnings.push(result.warning);
  if (linkValidation.validationWarning) warnings.push(linkValidation.validationWarning);
  if (linkValidation.linkType === 'search') warnings.push('Sem link direto ao produto — abrirá página de busca do fornecedor.');
  if (geminiUnavailable) warnings.push('Interpretação por IA indisponível; usando extração direta.');

  return {
    found: true,
    productName: result.productName,
    price: result.price,
    currency: result.currency,
    link: linkValidation.link,
    linkType: linkValidation.linkType,
    linkValidated: linkValidation.validated,
    sellerName: result.sellerName,
    freight: result.freight ?? 0,
    available: result.available !== false,
    warning: warnings.length > 0 ? warnings.join(' · ') : undefined,
    validationWarning: linkValidation.validationWarning,
    confidence,
    matchScore: result.matchScore,
    evidenceText: result.evidenceText,
    sourceUrl: searchUrl,
    sourceName: result.sourceName ?? 'jina-direct',
    geminiUnavailable: geminiUnavailable || undefined,
  };
}

/**
 * Função reutilizável: dado uma URL de busca, busca conteúdo e processa.
 */
export async function extractViaJinaAndGemini(
  supplier: Supplier,
  query: string,
  searchUrl: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const deadline = Date.now() + opts.timeoutMs;

  let pageContent: string;
  try {
    pageContent = await fetchViaJina(searchUrl, Math.min(15_000, deadline - Date.now()));
  } catch (e) {
    const err = e as Error & { jinaBlocked?: boolean };
    if (err.jinaBlocked) {
      return {
        found: false,
        errorMessage: 'Fornecedor bloqueou ou limitou leitura via Jina; fallback necessário',
        sourceUrl: searchUrl,
        sourceName: 'jina-blocked',
      };
    }
    return {
      found: false,
      errorMessage: `Jina(busca): ${err.message}`,
      sourceUrl: searchUrl,
      sourceName: 'jina-fetch-error',
    };
  }

  if (!pageContent || pageContent.length < 200) {
    return {
      found: false,
      errorMessage: 'conteúdo da página vazio/curto demais',
      sourceUrl: searchUrl,
      sourceName: 'jina-empty',
    };
  }

  if (Date.now() > deadline) {
    throw new TimeoutError(`Tempo esgotado para ${supplier.name}`);
  }

  return processJinaContent(supplier, query, searchUrl, pageContent, deadline);
}

/**
 * Scraper genérico (Jina + extração direta + Gemini opcional) com URL padrão.
 */
export async function scrapeViaJinaReader(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildDefaultSearchUrl(supplier, query);
  return extractViaJinaAndGemini(supplier, query, searchUrl, opts);
}

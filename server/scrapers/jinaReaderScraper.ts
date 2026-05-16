/**
 * Coletor de conteúdo do Motor Universal de Busca.
 *
 * ARQUITETURA (cadeia automática, sem modos visíveis ao usuário):
 *
 *   1. fetchDirectHtml — fetch direto da URL de busca do fornecedor
 *      → Funciona em sites simples (SSR, HTML estático).
 *   2. fetchViaJina — Jina Reader (HTML → markdown limpo)
 *      → Funciona quando o site é JS-heavy mas tolera o crawler do Jina.
 *   3. directExtractor — Motor Universal de Extração (JSON-LD, __NEXT_DATA__, markdown)
 *      → FONTE PRIMÁRIA de preço/produto/URL. Sem IA.
 *   4. urlValidator — valida estrutural + semanticamente o link antes
 *      de aceitar como link_type="product".
 *
 * Garantias:
 *   - Toda URL é validada (precisa aparecer na fonte).
 *   - Preço inválido OU URL inventada → resultado rejeitado com error_message claro.
 */
import { config } from '../config.js';
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
}

export interface ScrapeOptions {
  timeoutMs: number;
}

/**
 * Fetch direto do HTML (sem proxy/Jina). Funciona em sites que respondem
 * a User-Agent normal e não exigem JS no cliente.
 */
export async function fetchDirectHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!r.ok) {
      const status = r.status;
      if (status === 403 || status === 429 || status === 451) {
        const e = new Error(`Fornecedor bloqueou leitura (HTTP ${status})`);
        (e as Error & { siteBlocked?: boolean }).siteBlocked = true;
        throw e;
      }
      throw new Error(`HTTP ${status}`);
    }
    const ct = (r.headers.get('content-type') ?? '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.includes('text')) {
      throw new Error(`tipo de conteúdo inesperado: ${ct}`);
    }
    const txt = await r.text();
    // Trunca em 200KB para parsing pesado (JSON-LD costuma estar no header)
    return txt.slice(0, 200_000);
  } finally {
    clearTimeout(timer);
  }
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
      const status = r.status;
      if (status === 403 || status === 429 || status === 451) {
        const e = new Error(`Fornecedor bloqueou leitura via Jina (HTTP ${status})`);
        (e as Error & { jinaBlocked?: boolean }).jinaBlocked = true;
        throw e;
      }
      throw new Error(`Jina HTTP ${status}`);
    }
    const txt = await r.text();
    return txt.slice(0, 16_000);
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
 * Engine reutilizável: dado um conteúdo (HTML cru ou markdown Jina), faz
 * extração DIRETA universal + validação de link.
 */
async function processContent(
  supplier: Supplier,
  query: string,
  searchUrl: string,
  content: string,
  _deadline: number,
  sourceTag: string,
): Promise<ScrapedResult> {
  const result = extractDirectly(supplier, query, content, searchUrl);

  if (!result.found || !result.price || result.price <= 0 || !result.productName) {
    return {
      found: false,
      errorMessage: result.errorMessage ?? 'Preço não encontrado com segurança',
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? sourceTag,
    };
  }

  // Bloqueio de acessório / match score baixo
  if (result.matchScore !== undefined && result.matchScore < config.MIN_MATCH_SCORE) {
    return {
      found: false,
      errorMessage: `Produto encontrado parece ser acessório ou item diferente (match ${result.matchScore}%)`,
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? sourceTag,
      evidenceText: result.evidenceText,
    };
  }

  if (!result.evidenceText || result.evidenceText.trim().length < 8) {
    return {
      found: false,
      errorMessage: 'Preço encontrado sem evidência textual — rejeitado para evitar produto fantasma',
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? sourceTag,
    };
  }

  const linkValidation = validateProductUrl(result.link, supplier, content, searchUrl);

  if (!linkValidation.link) {
    return {
      found: false,
      errorMessage: 'Link de produto não validado — rejeitado para evitar produto fantasma',
      sourceUrl: searchUrl,
      sourceName: result.sourceName ?? sourceTag,
      evidenceText: result.evidenceText,
    };
  }

  let confidence = result.confidence ?? 70;
  if (!linkValidation.validated) confidence = Math.min(confidence, 50);
  if (result.matchScore !== undefined && result.matchScore < config.MATCH_SCORE_TRUSTED) {
    confidence = Math.min(confidence, 70);
  }

  const warnings: string[] = [];
  if (result.warning) warnings.push(result.warning);
  if (linkValidation.validationWarning) warnings.push(linkValidation.validationWarning);
  if (linkValidation.linkType === 'search') warnings.push('Sem link direto ao produto — abrirá página de busca do fornecedor.');
  if (result.matchScore !== undefined && result.matchScore >= config.MIN_MATCH_SCORE && result.matchScore < config.MATCH_SCORE_TRUSTED) {
    warnings.push(`Match parcial (${result.matchScore}%) — confirme nome no link antes de comprar.`);
  }

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
    sourceName: result.sourceName ?? sourceTag,
  };
}

/**
 * Cadeia Universal: tenta fetch direto (HTML cru) → Jina Reader → falha clara.
 * Em cada passo, faz extração via directExtractor (JSON-LD, __NEXT_DATA__, markdown).
 * Retorna o primeiro resultado VÁLIDO ou o erro padronizado mais informativo.
 */
export async function extractViaJina(
  supplier: Supplier,
  query: string,
  searchUrl: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const deadline = Date.now() + opts.timeoutMs;

  // ─── 1. Fetch direto do HTML (rápido para sites SSR/HTML estáticos) ───
  let directBlocked = false;
  let directErr: string | null = null;
  try {
    const remaining = Math.max(3_000, deadline - Date.now());
    const html = await fetchDirectHtml(searchUrl, Math.min(10_000, remaining));
    if (html && html.length >= 200) {
      const out = await processContent(supplier, query, searchUrl, html, deadline, 'fetch-direct');
      if (out.found) return out;
      // se não achou mas o HTML veio — pode ser que precise do Jina (markdown limpo). Continua.
    }
  } catch (e) {
    const err = e as Error & { siteBlocked?: boolean };
    if (err.siteBlocked) directBlocked = true;
    directErr = err.message;
  }

  if (Date.now() > deadline) {
    throw new TimeoutError(`Tempo esgotado para ${supplier.name}`);
  }

  // ─── 2. Jina Reader (lida com JS-heavy / SPAs) ───
  let jinaContent: string | null = null;
  try {
    const remaining = Math.max(3_000, deadline - Date.now());
    jinaContent = await fetchViaJina(searchUrl, Math.min(15_000, remaining));
  } catch (e) {
    const err = e as Error & { jinaBlocked?: boolean };
    if (err.jinaBlocked) {
      return {
        found: false,
        errorMessage: 'Fornecedor bloqueou leitura',
        sourceUrl: searchUrl,
        sourceName: 'jina-blocked',
      };
    }
    if (directBlocked) {
      return {
        found: false,
        errorMessage: 'Fornecedor bloqueou leitura',
        sourceUrl: searchUrl,
        sourceName: 'fetch-blocked',
      };
    }
    return {
      found: false,
      errorMessage: `Página não retornou conteúdo suficiente (${err.message || directErr || 'erro de rede'})`,
      sourceUrl: searchUrl,
      sourceName: 'fetch-error',
    };
  }

  if (!jinaContent || jinaContent.length < 200) {
    return {
      found: false,
      errorMessage: 'Página não retornou conteúdo suficiente',
      sourceUrl: searchUrl,
      sourceName: 'jina-empty',
    };
  }

  if (Date.now() > deadline) {
    throw new TimeoutError(`Tempo esgotado para ${supplier.name}`);
  }

  return processContent(supplier, query, searchUrl, jinaContent, deadline, 'jina');
}

/**
 * Scraper universal com URL padrão do fornecedor.
 * Mantido como entrypoint genérico para o dispatcher.
 */
export async function scrapeViaJinaReader(
  supplier: Supplier,
  query: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const searchUrl = buildDefaultSearchUrl(supplier, query);
  return extractViaJina(supplier, query, searchUrl, opts);
}

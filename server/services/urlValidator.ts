/**
 * urlValidator — valida URLs de produto antes de aceitá-las como link confiável.
 *
 * Objetivo: bloquear "produtos fantasma" — resultados que mostram preço mas
 * cujo link é inventado/quebrado.
 *
 * Estratégia:
 *  1. Validações estruturais (http/https, domínio do fornecedor, padrões inválidos)
 *  2. Validação SEMÂNTICA: a URL precisa ter aparecido no conteúdo coletado
 *     (se inventada pelo Gemini ou montada incorretamente, falha)
 *  3. Validação OPCIONAL via fetch (HEAD/GET) com timeout
 *     - 403/451 NÃO é falha (vários sites bloqueiam HEAD)
 *     - 404 explícito é falha
 *     - timeout é tratado como inconclusivo (mantém o que veio antes)
 */
import type { Supplier } from './supplierService.js';

export type LinkType = 'product' | 'search' | 'unverified';

export interface ValidationResult {
  link: string | null;
  linkType: LinkType;
  validated: boolean;
  validationWarning?: string | undefined;
}

const INVALID_URL_PLACEHOLDERS = new Set([
  '', '#', 'undefined', 'null', 'about:blank', 'javascript:void(0)', 'data:,',
]);

const PRODUCT_URL_PATTERNS: RegExp[] = [
  /\/MLB-?\d{6,}/i,
  /\/p\/MLB\d{6,}/i,
  /\/dp\/[A-Z0-9]{10}/,
  /\/gp\/product\/[A-Z0-9]{10}/,
  /-i\.\d{5,}\.\d{5,}/,
  /\/p\/[a-z0-9]{6,}[\/.]/i,
  /\/item\/\d{6,}/,
  /\/product-detail\//i,
  /\/produto\//i,
  /\/products\/[^/]+$/i,
];

const SEARCH_URL_HINTS = [
  '/search', '/busca', '/find', '/wholesale',
  '?q=', '?k=', '?keyword=', '?searchtext=', '?text=',
];

function hasProductPattern(url: string): boolean {
  return PRODUCT_URL_PATTERNS.some((p) => p.test(url));
}

function isSearchUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SEARCH_URL_HINTS.some((h) => lower.includes(h));
}

function structuralValid(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (INVALID_URL_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    if (!u.hostname || u.hostname === 'localhost') return false;
    return true;
  } catch {
    return false;
  }
}

function domainMatchesSupplier(url: string, supplier: Supplier): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const site = supplier.site.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
    if (!site) return false;
    // host pode ser subdomínio (ex: lista.mercadolivre.com.br ⊆ mercadolivre.com.br)
    return host === site || host.endsWith('.' + site) || site.endsWith('.' + host);
  } catch {
    return false;
  }
}

/**
 * Verifica se a URL aparece literalmente no conteúdo coletado.
 * Esta é a defesa principal contra URLs inventadas por IA.
 */
function appearsInContent(url: string, content: string | null | undefined): boolean {
  if (!content) return false;
  // Compara sem query string para tolerar variações em ?utm= etc
  const baseUrl = url.split('?')[0]?.split('#')[0] ?? url;
  if (content.includes(baseUrl)) return true;
  // Tolera variação de www/sem-www
  try {
    const u = new URL(url);
    const hostNoWww = u.hostname.replace(/^www\./, '');
    const altUrl = url.replace(u.hostname, hostNoWww);
    const altBase = altUrl.split('?')[0]?.split('#')[0] ?? altUrl;
    return content.includes(altBase);
  } catch {
    return false;
  }
}

/**
 * Validação síncrona (sem fetch) — usada SEMPRE.
 *
 * @param url URL candidata
 * @param supplier fornecedor esperado
 * @param sourceContent conteúdo onde a URL deveria aparecer (opcional)
 * @param fallbackSearchUrl URL de busca do fornecedor (usada se a candidata for ruim)
 */
export function validateProductUrl(
  url: string | null | undefined,
  supplier: Supplier,
  sourceContent?: string,
  fallbackSearchUrl?: string,
): ValidationResult {
  // 1. Validação estrutural
  if (!structuralValid(url)) {
    // Sem URL → marca search URL se houver
    if (fallbackSearchUrl && structuralValid(fallbackSearchUrl)) {
      return {
        link: fallbackSearchUrl,
        linkType: 'search',
        validated: true, // search URL é válida como search
        validationWarning: 'Link direto não fornecido; mostrando página de busca.',
      };
    }
    return {
      link: null,
      linkType: 'unverified',
      validated: false,
      validationWarning: 'URL inválida ou ausente.',
    };
  }

  // 2. Domínio coerente com fornecedor
  if (!domainMatchesSupplier(url, supplier)) {
    return {
      link: fallbackSearchUrl ?? null,
      linkType: fallbackSearchUrl ? 'search' : 'unverified',
      validated: false,
      validationWarning: `Domínio do link não corresponde ao fornecedor (${supplier.site}).`,
    };
  }

  // 3. Aparece no conteúdo coletado? (defesa contra IA inventando URL)
  if (sourceContent && !appearsInContent(url, sourceContent)) {
    return {
      link: fallbackSearchUrl ?? url,
      linkType: 'search',
      validated: false,
      validationWarning: 'URL do produto não foi encontrada na fonte coletada — possivelmente inferida. Usando link de busca.',
    };
  }

  // 4. É produto ou busca?
  if (hasProductPattern(url)) {
    return { link: url, linkType: 'product', validated: true };
  }
  if (isSearchUrl(url)) {
    return {
      link: url,
      linkType: 'search',
      validated: true,
      validationWarning: 'Link direto ao produto não encontrado; abrindo página de busca do fornecedor.',
    };
  }

  // URL coerente com domínio mas sem padrão claro — trata como search interna
  return {
    link: url,
    linkType: 'search',
    validated: true,
    validationWarning: 'Link aponta ao site do fornecedor mas sem padrão de produto reconhecível.',
  };
}

/**
 * Validação OPCIONAL via fetch — usada apenas em modo "validate-with-fetch".
 * Sites podem retornar 403/451 mesmo para URLs válidas, então só 404 é falha.
 */
export async function validateUrlReachable(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)' },
    });
    // 404 é definitivo: link quebrado
    if (r.status === 404 || r.status === 410) return { ok: false, status: r.status };
    // 200-299 ok; 3xx redirect; 401/403/429/451 inconclusivo (assume válido)
    return { ok: true, status: r.status };
  } catch {
    // Timeout/erro de rede = inconclusivo
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * candidateUrlExtractor — extrai e normaliza links de uma página HTML (Etapa 6).
 *
 * Extrai de:
 *   - hrefs de <a> (absolutos e relativos)
 *   - <link rel="canonical">
 *   - <meta property="og:url">
 *   - URLs em blocos <script> JSON
 *
 * Para cada link:
 *   - normaliza relativo → absoluto via baseUrl
 *   - remove parâmetros de rastreamento (utm_*, fbclid, gclid, etc.)
 *   - descarta assets (imagens, CSS, JS, fontes)
 *   - descarta login, carrinho, checkout, homepage
 *   - deduplica (comparando URL limpa)
 *
 * Função PURA — sem rede, sem DB.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid',
  'ttclid',
  'igshid',
  '_gl',
]);

const REJECT_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\/checkout(\/|$|\?)/i, reason: 'checkout' },
  { rx: /\/finalizar/i, reason: 'checkout' },
  { rx: /\/cart(\/|$|\?)/i, reason: 'cart' },
  { rx: /\/carrinho(\/|$|\?)/i, reason: 'cart' },
  { rx: /\/(login|signin|sign-in|entrar)(\/|$|\?)/i, reason: 'login' },
  { rx: /\/(account|conta|minha-conta)(\/|$|\?)/i, reason: 'login' },
  { rx: /\.(?:png|jpe?g|gif|webp|svg|css|js|ico|woff2?|ttf|eot|mp4|pdf)(?:\?|#|$)/i, reason: 'asset' },
];

function isHomeOrShallow(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path === '' || path === '/';
  } catch {
    return false;
  }
}

/** Devolve o hostname limpo do fornecedor (sem www, sem porta). */
export function getSupplierDomain(supplier: { site: string }): string {
  const site = supplier.site;
  try {
    const withScheme = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return site.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? site;
  }
}

/** Normaliza href relativo para absoluto. Retorna null se inválido. */
export function normalizeCandidateUrl(href: string, baseUrl: string): string | null {
  if (!href || /^(?:javascript:|mailto:|tel:)/i.test(href) || href.startsWith('#')) {
    return null;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Remove parâmetros de rastreamento conhecidos preservando o resto da URL. */
export function removeTrackingParams(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    for (const key of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export type ExtractedUrlSource =
  | 'href'
  | 'canonical'
  | 'og_url'
  | 'json_script'
  | 'provider_links';

export interface ExtractedUrl {
  url: string;
  text?: string;
  source: ExtractedUrlSource;
}

export interface ExtractUrlsInput {
  html: string;
  baseUrl: string;
  /** Quando fornecido, descarta URLs de domínio completamente diferente. */
  supplierDomain?: string;
  /**
   * Links já descobertos por um provider (ex: Firecrawl formats:["links"]).
   * Passam pela mesma normalização/filtragem/dedupe dos links do HTML.
   */
  extraLinks?: string[];
}

export interface ExtractUrlsResult {
  urls: ExtractedUrl[];
  rejectionReasons: Record<string, number>;
}

function incReason(map: Record<string, number>, reason: string): void {
  map[reason] = (map[reason] ?? 0) + 1;
}

function isSameDomain(urlStr: string, supplierDomain: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    const normalized = host.startsWith('www.') ? host.slice(4) : host;
    return normalized === supplierDomain || normalized.endsWith(`.${supplierDomain}`);
  } catch {
    return false;
  }
}

/**
 * Extrai todos os links válidos do HTML, normalizados e limpos.
 */
export function extractUrls(input: ExtractUrlsInput): ExtractUrlsResult {
  const { html, baseUrl, supplierDomain, extraLinks } = input;
  const seen = new Set<string>();
  const results: ExtractedUrl[] = [];
  const rejectionReasons: Record<string, number> = {};

  function tryAdd(href: string, text: string | undefined, source: ExtractedUrlSource): void {
    const abs = normalizeCandidateUrl(href, baseUrl);
    if (!abs) {
      incReason(rejectionReasons, 'normalize_failed');
      return;
    }

    if (!/^https?:\/\//i.test(abs)) {
      incReason(rejectionReasons, 'non_http');
      return;
    }

    if (isHomeOrShallow(abs)) {
      incReason(rejectionReasons, 'home');
      return;
    }

    for (const { rx, reason } of REJECT_PATTERNS) {
      if (rx.test(abs)) {
        incReason(rejectionReasons, reason);
        return;
      }
    }

    if (supplierDomain && !isSameDomain(abs, supplierDomain)) {
      incReason(rejectionReasons, 'different_domain');
      return;
    }

    const cleaned = removeTrackingParams(abs);

    if (seen.has(cleaned)) {
      incReason(rejectionReasons, 'duplicate');
      return;
    }
    seen.add(cleaned);
    results.push({ url: cleaned, text, source });
  }

  // 1. <a href="..."> links
  const linkRx = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRx.exec(html)) !== null) {
    const href = m[1]?.trim() ?? '';
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    tryAdd(href, inner || undefined, 'href');
  }

  // 2. <link rel="canonical" href="...">
  const canonicalMatch =
    html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i) ??
    html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i);
  if (canonicalMatch?.[1]) {
    tryAdd(canonicalMatch[1].trim(), undefined, 'canonical');
  }

  // 3. <meta property="og:url" content="...">
  const ogMatch =
    html.match(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']([^"']+)["']/i) ??
    html.match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:url["']/i);
  if (ogMatch?.[1]) {
    tryAdd(ogMatch[1].trim(), undefined, 'og_url');
  }

  // 4. URLs em blocos <script> com conteúdo JSON
  const scriptRx = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRx.exec(html)) !== null) {
    const content = m[1] ?? '';
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;

    const urlRx = /"(https?:\/\/[^"]{10,300})"/g;
    let um: RegExpExecArray | null;
    while ((um = urlRx.exec(content)) !== null) {
      const candidate = um[1];
      if (
        candidate &&
        !/\.(?:png|jpe?g|gif|webp|svg|css|js|ico|woff2?|ttf|eot)(?:\?|$)/i.test(candidate)
      ) {
        tryAdd(candidate, undefined, 'json_script');
      }
    }
  }

  // 5. Links já descobertos por um provider externo (ex: Firecrawl).
  if (extraLinks) {
    for (const link of extraLinks) {
      tryAdd(link, undefined, 'provider_links');
    }
  }

  return { urls: results, rejectionReasons };
}

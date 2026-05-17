/**
 * Construtor canônico de URLs de busca de fornecedores.
 *
 * Regras rígidas:
 *  - Apenas templates com placeholder ({q} / {query} / {produto}) recebem
 *    a query interpolada.
 *  - A query é SEMPRE passada por encodeURIComponent.
 *  - Sem template → fallback genérico de busca (NUNCA URL de produto).
 *  - Validação rejeita templates que não sejam URLs http(s) válidas.
 *
 * Garantias anti produto fantasma:
 *  - NUNCA inventa URL de página de produto. O fallback é sempre /search?q=...
 *    no domínio do fornecedor, jamais um link "/p/" ou "/dp/" inferido.
 */

/** Placeholders aceitos no template, case-insensitive. */
const PLACEHOLDER_RX_GLOBAL = /\{(?:q|query|produto)\}/gi;
const PLACEHOLDER_RX_TEST = /\{(?:q|query|produto)\}/i;

export interface BuiltSearchUrl {
  /** URL final pronta para fetch */
  url: string;
  /** true quando a URL foi gerada pelo fallback (domínio + /search?q=) */
  isFallback: boolean;
}

/**
 * Detecta se o template contém algum dos placeholders aceitos.
 */
export function hasPlaceholder(template: string | null | undefined): boolean {
  if (!template) return false;
  return PLACEHOLDER_RX_TEST.test(template);
}

/**
 * Remove protocolo, www e trailing slash. Resultado: "amazon.com.br".
 */
export function normalizeSite(site: string): string {
  return site
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/**
 * Aceita "amazon.com.br" ou "https://amazon.com.br". Rejeita "amazon" (sem TLD),
 * "localhost", IPs sem domínio, e qualquer coisa que não pareça um host real.
 */
export function isValidSiteOrUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length < 4) return false;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }

  if (!host || host === 'localhost') return false;
  if (!host.includes('.')) return false;
  // Apenas caracteres válidos de DNS
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return false;
  return true;
}

/**
 * Valida que o template é uma URL http(s) válida (com ou sem placeholder).
 * Substitui placeholders por valor de teste antes de validar.
 */
export function isValidSearchUrlTemplate(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length < 8) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;

  const test = trimmed.replace(PLACEHOLDER_RX_GLOBAL, 'test');
  try {
    const u = new URL(test);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname || !u.hostname.includes('.')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Constrói a URL de busca final. Regras:
 *  - Template com placeholder → interpola query (encodeURIComponent).
 *  - Template sem placeholder → usa template como está (UI deve avisar).
 *  - Sem template → fallback genérico: https://<dominio>/search?q=<query>
 *
 * Nunca constrói URL de produto. O fallback é sempre página de busca.
 */
export function buildSearchUrl(
  template: string | null | undefined,
  site: string,
  query: string,
): BuiltSearchUrl {
  const q = encodeURIComponent(query.trim());

  if (template && template.trim().length > 0) {
    const t = template.trim();
    if (hasPlaceholder(t)) {
      return { url: t.replace(PLACEHOLDER_RX_GLOBAL, q), isFallback: false };
    }
    // Template fixo sem placeholder — UI deve avisar; aqui usamos como está.
    return { url: t, isFallback: false };
  }

  const domain = normalizeSite(site);
  return {
    url: `https://${domain}/search?q=${q}`,
    isFallback: true,
  };
}

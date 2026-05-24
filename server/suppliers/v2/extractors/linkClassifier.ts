/**
 * Classificador de URL — decide se um link é página de PRODUTO ou algo que
 * nunca pode ser tratado como produto final (busca, categoria, home, carrinho,
 * login, checkout).
 *
 * Reúne em um só lugar os padrões espalhados (candidateExtractor, rankingService,
 * directExtractor legado) para o orquestrador local ter uma fonte única.
 *
 * Função PURA.
 */

export type LinkClass =
  | 'product'
  | 'search'
  | 'category'
  | 'home'
  | 'cart'
  | 'login'
  | 'checkout'
  | 'unknown';

const PRODUCT_PATTERNS: RegExp[] = [
  /\/MLB-?\d{6,}/i,
  /\/p\/MLB\d{6,}/i,
  /\/dp\/[A-Z0-9]{8,}/i,
  /\/gp\/product\/[A-Z0-9]{8,}/i,
  /-i\.\d{5,}\.\d{5,}/i,
  /\/p\/[a-z0-9][^/]{4,}[\/.]?$/i,
  /\/item\/\d{6,}/i,
  /\/product[-_]detail\//i,
  /\/produtos?\/[^/]+/i,
  /\/products?\/[^/]+/i,
  /\/sku\//i,
];

const NEGATIVE_PATTERNS: Array<{ rx: RegExp; type: LinkClass }> = [
  { rx: /\/checkout(\/|$|\?)/i, type: 'checkout' },
  { rx: /\/finalizar/i, type: 'checkout' },
  { rx: /\/cart(\/|$|\?)/i, type: 'cart' },
  { rx: /\/carrinho(\/|$|\?)/i, type: 'cart' },
  { rx: /\/(login|signin|sign-in|entrar)(\/|$|\?)/i, type: 'login' },
  { rx: /\/(account|conta|minha-conta)(\/|$|\?)/i, type: 'login' },
  { rx: /\/(search|busca|s\?|find)(\/|$|\?)?/i, type: 'search' },
  { rx: /[?&](q|query|search|busca|k)=/i, type: 'search' },
  { rx: /\/(category|categoria|categories|collections?|departamento|c\/)/i, type: 'category' },
];

function isHomeOrShallow(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return path === '' || path === '/';
  } catch {
    return false;
  }
}

export interface UrlClassification {
  type: LinkClass;
  isProduct: boolean;
  reason: string;
}

export function classifyUrl(url: string): UrlClassification {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { type: 'unknown', isProduct: false, reason: 'url ausente ou relativa' };
  }

  // Negativos primeiro — uma URL de busca que também tem /p/ não deve passar.
  for (const neg of NEGATIVE_PATTERNS) {
    if (neg.rx.test(url)) {
      return { type: neg.type, isProduct: false, reason: `padrão ${neg.type}` };
    }
  }

  if (isHomeOrShallow(url)) {
    return { type: 'home', isProduct: false, reason: 'homepage / path vazio' };
  }

  for (const p of PRODUCT_PATTERNS) {
    if (p.test(url)) {
      return { type: 'product', isProduct: true, reason: `padrão de produto ${p.source}` };
    }
  }

  return { type: 'unknown', isProduct: false, reason: 'sem padrão de produto reconhecido' };
}

/** Atalho booleano. */
export function isProductUrl(url: string): boolean {
  return classifyUrl(url).isProduct;
}

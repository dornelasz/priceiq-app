/**
 * Descobre a URL de busca de um fornecedor por camadas (sem rede):
 *
 *   A. Plataforma conhecida → padrão padrão da plataforma.
 *   B. Formulário <form> com input name=q/query/search/s/term no HTML.
 *   C. Template legado salvo no supplier (search_url_template antigo).
 *   D. Nenhum → null.
 *
 * Função PURA — não chama fetch. O orquestrador (autoConfigureSupplier)
 * é quem decide se vai validar a URL com requisição real.
 */

export interface SearchDiscoveryInput {
  baseUrl: string;
  homepageHtml?: string;
  platformDetected?: string | null;
  legacyTemplate?: string | null;
  testQuery?: string;
}

export type SearchDiscoveryMethod =
  | 'known_platform'
  | 'form_detected'
  | 'pattern_tested'
  | 'legacy'
  | 'none';

export interface SearchDiscoveryResult {
  searchUrlTemplate: string | null;
  confidence: number;
  method: SearchDiscoveryMethod;
  testedPatterns: string[];
  evidence?: string;
}

// Padrões conhecidos por plataforma (placeholder {query} = termo buscado)
const KNOWN_PLATFORM_PATTERNS: Record<string, string> = {
  shopify: '/search?q={query}',
  woocommerce: '/?s={query}&post_type=product',
  vtex: '/{query}?_q={query}&map=ft',
  magento: '/catalogsearch/result/?q={query}',
  opencart: '/index.php?route=product/search&search={query}',
  nuvemshop: '/search?q={query}',
  tray: '/loja/busca.php?loja=&palavra_busca={query}',
  loja_integrada: '/catalogo/?q={query}',
  nextjs: '/search?q={query}',
};

// Inputs típicos de busca, em ordem de preferência
const SEARCH_INPUT_NAMES = ['q', 'query', 'search', 's', 'term'];

function normalizeBase(url: string): string {
  try {
    const withScheme = url.startsWith('http') ? url : `https://${url}`;
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function extractFormTemplate(
  html: string,
  baseUrl: string,
): { template: string; evidence: string } | null {
  const formRegex = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = formRegex.exec(html)) !== null) {
    const fullForm = match[0];
    const inner = match[1] ?? '';
    // Procura input com name=q/query/search/s/term (case-insensitive)
    const inputNameRx = new RegExp(
      `<input[^>]+name=["']?(${SEARCH_INPUT_NAMES.join('|')})["']?[^>]*`,
      'i',
    );
    const inputMatch = inner.match(inputNameRx);
    if (!inputMatch) continue;
    const inputName = inputMatch[1];

    // Pega action do form (pode estar antes do >, atributo opcional)
    const actionMatch = fullForm.match(/action=["']([^"']+)["']/i);
    const action = actionMatch ? actionMatch[1] : '/';

    let actionUrl: string;
    try {
      actionUrl = new URL(action, baseUrl).toString();
    } catch {
      actionUrl = action.startsWith('/') ? `${baseUrl}${action}` : action;
    }

    const separator = actionUrl.includes('?') ? '&' : '?';
    const template = `${actionUrl}${separator}${inputName}={query}`;
    return {
      template,
      evidence: `<form action="${action}"> com <input name="${inputName}">`,
    };
  }
  return null;
}

export function discoverSearchUrl(
  input: SearchDiscoveryInput,
): SearchDiscoveryResult {
  const base = normalizeBase(input.baseUrl);
  const tested: string[] = [];

  // A. Plataforma conhecida
  if (input.platformDetected) {
    const platformPattern = KNOWN_PLATFORM_PATTERNS[input.platformDetected];
    if (platformPattern) {
      const tpl = `${base}${platformPattern}`;
      tested.push(tpl);
      return {
        searchUrlTemplate: tpl,
        confidence: 80,
        method: 'known_platform',
        testedPatterns: tested,
        evidence: `Padrão conhecido da plataforma ${input.platformDetected}`,
      };
    }
  }

  // B. Detecta formulário no HTML
  if (input.homepageHtml) {
    const formResult = extractFormTemplate(input.homepageHtml, base);
    if (formResult) {
      tested.push(formResult.template);
      return {
        searchUrlTemplate: formResult.template,
        confidence: 70,
        method: 'form_detected',
        testedPatterns: tested,
        evidence: formResult.evidence,
      };
    }
  }

  // C. Template legado
  if (input.legacyTemplate && input.legacyTemplate.trim() !== '') {
    return {
      searchUrlTemplate: input.legacyTemplate,
      confidence: 40,
      method: 'legacy',
      testedPatterns: tested,
      evidence: 'search_url_template legado do fornecedor',
    };
  }

  // D. Nada
  return {
    searchUrlTemplate: null,
    confidence: 0,
    method: 'none',
    testedPatterns: tested,
  };
}

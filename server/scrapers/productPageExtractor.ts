/**
 * Fase 2 do fluxo de duas fases: abre a página de produto de um candidato
 * e extrai o preço com evidência textual.
 *
 * Garantias:
 *  - Preço DEVE aparecer no conteúdo da página de produto (não inventado).
 *  - evidenceText DEVE conter o trecho onde o preço foi encontrado.
 *  - Produto incompatível com a query retorna status 'product_mismatch'.
 *  - Fornecedor bloqueado retorna status 'blocked'.
 *  - Timeout retorna status 'timeout'.
 *
 * Estratégia de fetch: direto → Jina Reader. Playwright NÃO é chamado aqui
 * porque a Fase 2 pode tentar até 3 URLs e o custo de Playwright por URL
 * ultrapassaria o timeout do fornecedor.
 */
import type { Supplier } from '../services/supplierService.js';
import type { ScrapedResult, ScrapeOptions } from './jinaReaderScraper.js';
import { fetchDirectHtml, fetchViaJina } from './jinaReaderScraper.js';
import { extractDirectly } from './directExtractor.js';
import { validateProductUrl } from '../services/urlValidator.js';
import { config } from '../config.js';

/**
 * Busca e valida a página de produto em `productUrl`.
 *
 * @param supplier       Fornecedor (define currency, site, etc.)
 * @param query          Termo de busca original
 * @param productUrl     URL absoluta da página de produto (vinda da Fase 1)
 * @param searchUrl      URL da página de busca (usada como fallback de link)
 * @param opts           Opções de scraping (contém timeoutMs restante)
 */
export async function extractProductPage(
  supplier: Supplier,
  query: string,
  productUrl: string,
  searchUrl: string,
  opts: ScrapeOptions,
): Promise<ScrapedResult> {
  const deadline = Date.now() + opts.timeoutMs;

  let content: string | null = null;
  let sourceName = 'product-direct';
  let blocked = false;

  // ─── 1. Fetch direto ────────────────────────────────────────
  try {
    const remaining = Math.max(3_000, deadline - Date.now());
    const html = await fetchDirectHtml(productUrl, Math.min(10_000, remaining));
    if (html && html.length >= 200) content = html;
  } catch (e) {
    const err = e as Error & { siteBlocked?: boolean };
    if (err.siteBlocked) blocked = true;
  }

  // ─── 2. Jina Reader (se direto não bastou) ──────────────────
  if (!content) {
    if (Date.now() > deadline) {
      return {
        found: false,
        status: 'timeout',
        errorMessage: 'Tempo esgotado ao buscar página do produto',
        sourceUrl: productUrl,
        sourceName: 'product-timeout',
      };
    }
    try {
      const remaining = Math.max(3_000, deadline - Date.now());
      const jina = await fetchViaJina(productUrl, Math.min(15_000, remaining));
      if (jina && jina.length >= 200) {
        content = jina;
        sourceName = 'product-jina';
      }
    } catch (e) {
      const err = e as Error & { jinaBlocked?: boolean };
      if (err.jinaBlocked || blocked) {
        return {
          found: false,
          status: 'blocked',
          errorMessage: 'Fornecedor bloqueou leitura da página do produto',
          sourceUrl: productUrl,
          sourceName: 'product-blocked',
        };
      }
      return {
        found: false,
        status: 'error',
        errorMessage: `Erro ao buscar página do produto: ${(e as Error).message}`,
        sourceUrl: productUrl,
        sourceName: 'product-error',
      };
    }
  }

  if (!content || content.length < 200) {
    return {
      found: false,
      status: 'not_found',
      errorMessage: 'Página do produto não retornou conteúdo suficiente',
      sourceUrl: productUrl,
      sourceName: 'product-empty',
    };
  }

  // ─── 3. Extração do produto na página ───────────────────────
  const extracted = extractDirectly(supplier, query, content, productUrl);

  if (!extracted.found || !extracted.productName) {
    return {
      found: false,
      status: 'not_found',
      errorMessage: extracted.errorMessage ?? 'Nenhum produto encontrado na página do produto',
      sourceUrl: productUrl,
      sourceName: sourceName,
    };
  }

  if (!extracted.price || extracted.price <= 0) {
    return {
      found: false,
      status: 'price_not_found',
      errorMessage: 'Preço não encontrado na página do produto',
      sourceUrl: productUrl,
      sourceName: sourceName,
      evidenceText: extracted.evidenceText,
    };
  }

  if (!extracted.evidenceText || extracted.evidenceText.trim().length < 8) {
    return {
      found: false,
      status: 'price_not_found',
      errorMessage: 'Preço sem evidência textual na página do produto — rejeitado para evitar produto fantasma',
      sourceUrl: productUrl,
      sourceName: sourceName,
    };
  }

  if (extracted.matchScore !== undefined && extracted.matchScore < config.MIN_MATCH_SCORE) {
    return {
      found: false,
      status: 'product_mismatch',
      errorMessage: `Página do produto parece ser item diferente do buscado (match ${extracted.matchScore}%)`,
      sourceUrl: productUrl,
      sourceName: sourceName,
      evidenceText: extracted.evidenceText,
    };
  }

  // ─── 4. Validação do link ────────────────────────────────────
  // A URL foi buscada com sucesso, portanto o link é automaticamente válido.
  // validateProductUrl é chamado para determinar linkType e validationWarning.
  const linkValidation = validateProductUrl(productUrl, supplier, content, searchUrl);

  const warnings: string[] = [];
  if (extracted.warning) warnings.push(extracted.warning);
  if (linkValidation.validationWarning) warnings.push(linkValidation.validationWarning);

  return {
    found: true,
    status: 'validated',
    productName: extracted.productName,
    price: extracted.price,
    currency: extracted.currency,
    link: productUrl,
    linkType: 'product',
    linkValidated: true,
    sellerName: extracted.sellerName,
    freight: extracted.freight ?? 0,
    available: extracted.available !== false,
    warning: warnings.length > 0 ? warnings.join(' · ') : undefined,
    validationWarning: linkValidation.validationWarning,
    confidence: Math.max(extracted.confidence ?? 70, 75),
    matchScore: extracted.matchScore,
    evidenceText: extracted.evidenceText,
    sourceUrl: productUrl,
    sourceName: sourceName,
  };
}

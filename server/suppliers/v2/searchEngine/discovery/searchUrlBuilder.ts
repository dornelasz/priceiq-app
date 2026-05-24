/**
 * searchUrlBuilder (discovery) — seleciona o template correto e delega ao
 * construtor canônico de server/lib/searchUrlBuilder.ts (Etapa 6).
 *
 * Prioridade:
 *   1. recipe.searchUrlTemplate (mais específica, gerada pelo autoConfig)
 *   2. supplier.search_url_template (template legado do banco)
 *   3. Fallback genérico /search?q= via lib (nunca inventa URL de produto)
 *
 * Função PURA — sem rede, sem DB.
 */
import {
  buildSearchUrl as libBuildSearchUrl,
  hasPlaceholder,
} from '../../../../lib/searchUrlBuilder.js';
import type { Supplier } from '../../../../services/supplierService.js';
import type { SupplierRecipe } from '../../types.js';

export type SearchUrlSource =
  | 'recipe_template'
  | 'legacy_template'
  | 'fallback';

export interface BuildDiscoverySearchUrlInput {
  supplier: Supplier;
  recipe?: SupplierRecipe | null;
  query: string;
}

export interface BuildDiscoverySearchUrlResult {
  url: string;
  source: SearchUrlSource;
  isFallback: boolean;
}

/**
 * Escolhe o melhor template disponível para o fornecedor e constrói a URL de
 * busca com a query encodada. Nunca retorna URL de produto.
 */
export function buildDiscoverySearchUrl(
  input: BuildDiscoverySearchUrlInput,
): BuildDiscoverySearchUrlResult {
  const { supplier, recipe, query } = input;

  const recipeTemplate = recipe?.searchUrlTemplate?.trim() || null;
  const legacyTemplate = supplier.search_url_template?.trim() || null;

  if (recipeTemplate) {
    const built = libBuildSearchUrl(recipeTemplate, supplier.site, query);
    return { url: built.url, source: 'recipe_template', isFallback: built.isFallback };
  }

  if (legacyTemplate && hasPlaceholder(legacyTemplate)) {
    const built = libBuildSearchUrl(legacyTemplate, supplier.site, query);
    return { url: built.url, source: 'legacy_template', isFallback: built.isFallback };
  }

  // Fallback: /search?q= on supplier site
  const built = libBuildSearchUrl(null, supplier.site, query);
  return { url: built.url, source: 'fallback', isFallback: true };
}

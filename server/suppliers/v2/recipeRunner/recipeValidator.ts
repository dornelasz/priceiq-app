/**
 * Validador de receita — verifica se a SupplierRecipe está minimamente
 * executável pelo Recipe Runner.
 *
 * Falha controlada: se a receita não está pronta, o runner devolve
 * `status='needs_supplier_setup'` (NÃO error técnico).
 *
 * Função PURA — não toca rede ou DB.
 */
import type { SupplierRecipe } from '../types.js';

export interface RecipeValidationResult {
  valid: boolean;
  reason?: string;
}

const PLACEHOLDER_RX = /\{(?:q|query|produto)\}/i;

export function validateRecipe(
  recipe: SupplierRecipe | null | undefined,
): RecipeValidationResult {
  if (!recipe) {
    return { valid: false, reason: 'receita ausente' };
  }
  if (!recipe.supplierId || recipe.supplierId.trim() === '') {
    return { valid: false, reason: 'supplierId ausente na receita' };
  }
  if (recipe.status !== 'certified') {
    return {
      valid: false,
      reason: `receita não certificada (status="${recipe.status}")`,
    };
  }
  if (!recipe.searchUrlTemplate || recipe.searchUrlTemplate.trim() === '') {
    return { valid: false, reason: 'searchUrlTemplate ausente' };
  }
  if (!PLACEHOLDER_RX.test(recipe.searchUrlTemplate)) {
    return {
      valid: false,
      reason: 'searchUrlTemplate sem placeholder {query}/{q}/{produto}',
    };
  }
  return { valid: true };
}

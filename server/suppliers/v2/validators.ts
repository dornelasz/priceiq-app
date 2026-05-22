/**
 * Helpers de validação de alto nível sobre UniversalSearchResult.
 *
 * Estes helpers definem dois conceitos centrais do contrato V2:
 *  - isValidatedUniversalSearchResult: o resultado tem produto + preço com
 *    evidência textual e link de produto verificado. NÃO exige frete.
 *  - canConfirmFinalTotal: além do produto/preço válido, há frete confirmado
 *    (valor explícito) ou confirmadamente grátis — ou seja, o total final
 *    do produto pode ser exibido com segurança.
 */
import type { UniversalSearchResult } from './types.js';

/**
 * Verifica se um UniversalSearchResult representa um produto/preço
 * VALIDADO (com evidência e link de produto verificado).
 *
 * Frete NÃO é critério. Um resultado pode estar validated com
 * freightStatus="not_available".
 *
 * Exige:
 *  - found === true
 *  - status === "validated"
 *  - productName presente e não vazio
 *  - price é número finito > 0
 *  - currency presente e não vazia
 *  - productUrl presente e não vazio
 *  - linkType === "product"
 *  - linkValidated === true
 *  - evidence existe com evidenceText não vazio
 */
export function isValidatedUniversalSearchResult(
  result: UniversalSearchResult,
): boolean {
  if (result.found !== true) return false;
  if (result.status !== 'validated') return false;
  if (!result.productName || result.productName.trim() === '') return false;
  if (
    typeof result.price !== 'number' ||
    !Number.isFinite(result.price) ||
    result.price <= 0
  ) {
    return false;
  }
  if (!result.currency || result.currency.trim() === '') return false;
  if (!result.productUrl || result.productUrl.trim() === '') return false;
  if (result.linkType !== 'product') return false;
  if (result.linkValidated !== true) return false;
  if (!result.evidence) return false;
  if (
    typeof result.evidence.evidenceText !== 'string' ||
    result.evidence.evidenceText.trim() === ''
  ) {
    return false;
  }
  return true;
}

/**
 * Verifica se podemos exibir o total final do produto com segurança.
 *
 * Exige:
 *  - price é número finito > 0
 *  - freightStatus é "confirmed" ou "free_confirmed"
 *  - freight é número finito; 0 só é aceito quando freightStatus="free_confirmed"
 *
 * "estimated" e "not_available" NUNCA confirmam o total final.
 */
export function canConfirmFinalTotal(result: UniversalSearchResult): boolean {
  if (
    typeof result.price !== 'number' ||
    !Number.isFinite(result.price) ||
    result.price <= 0
  ) {
    return false;
  }

  if (result.freightStatus === 'free_confirmed') {
    return result.freight === 0;
  }

  if (result.freightStatus === 'confirmed') {
    return (
      typeof result.freight === 'number' &&
      Number.isFinite(result.freight) &&
      result.freight > 0
    );
  }

  return false;
}

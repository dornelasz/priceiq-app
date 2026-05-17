/**
 * ResultStatus — contrato único do resultado da busca por fornecedor.
 *
 * Cada fornecedor processado termina com EXATAMENTE um destes status.
 * Mapeamento principal:
 *   - validated       sucesso completo (productName + price>0 + currency + link válido + evidence)
 *   - cached          resultado válido reutilizado do cache
 *   - not_found       página abriu, nenhum produto compatível na resposta
 *   - blocked         HTTP 403/429/451, CAPTCHA, Cloudflare, bot protection
 *   - invalid_link    link inválido / domínio errado / não aparece na fonte
 *   - price_not_found produto encontrado mas preço não confirmado
 *   - product_mismatch produto encontrado mas é acessório / categoria diferente
 *   - timeout         fornecedor demorou além do limite
 *   - error           erro inesperado (rede, parser, etc.)
 *
 * Decisão do status:
 *   - scraper define o status inicial (validated, blocked, not_found, invalid_link,
 *     price_not_found, product_mismatch).
 *   - worker pode reescrever para 'cached' (cache hit) ou 'timeout'/'error'
 *     (interceptação externa).
 *
 * Resultados com status === 'validated' ou 'cached' são compráveis.
 * Qualquer outro status é falha — NÃO mostrar como compra válida.
 */
export type ResultStatus =
  | 'validated'
  | 'cached'
  | 'not_found'
  | 'blocked'
  | 'invalid_link'
  | 'price_not_found'
  | 'product_mismatch'
  | 'timeout'
  | 'error';

export const RESULT_STATUSES: readonly ResultStatus[] = [
  'validated',
  'cached',
  'not_found',
  'blocked',
  'invalid_link',
  'price_not_found',
  'product_mismatch',
  'timeout',
  'error',
] as const;

export function isSuccessStatus(s: ResultStatus | null | undefined): boolean {
  return s === 'validated' || s === 'cached';
}

/**
 * Deriva status final no worker considerando cache + payload do scraper.
 * Garante que todo resultado termine com um status concreto.
 */
export function deriveWorkerStatus(input: {
  fromCache: boolean;
  found: boolean;
  hasPrice: boolean;
  hasCurrency: boolean;
  scraperStatus?: ResultStatus | null;
}): ResultStatus {
  const valid = input.found && input.hasPrice && input.hasCurrency;
  if (valid) return input.fromCache ? 'cached' : (input.scraperStatus ?? 'validated');
  return input.scraperStatus ?? 'error';
}

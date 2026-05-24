import type { ResultStatus } from './types';

export function isSuccessStatus(s: ResultStatus | null | undefined): boolean {
  return s === 'validated' || s === 'cached';
}

export function isPartialStatus(s: ResultStatus | null | undefined): boolean {
  return s === 'partial';
}

const LABELS: Record<ResultStatus, string> = {
  validated: 'Validado',
  cached: 'Cache',
  partial: 'Frete a confirmar',
  not_found: 'Produto não encontrado',
  blocked: 'Fornecedor bloqueou leitura',
  invalid_link: 'Link do produto inválido',
  price_not_found: 'Preço não confirmado',
  product_mismatch: 'Produto diferente do buscado',
  timeout: 'Tempo esgotado',
  error: 'Erro inesperado',
};

export function statusLabel(s: ResultStatus | null | undefined): string {
  if (!s) return LABELS.error;
  return LABELS[s] ?? LABELS.error;
}

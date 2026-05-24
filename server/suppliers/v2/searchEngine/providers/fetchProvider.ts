/**
 * FetchProvider — contrato de provider de COLETA do motor próprio (Etapa 5).
 *
 * Um FetchProvider abstrai "como obter o conteúdo de uma URL". O motor pode
 * ter vários: o nativo (motor próprio, prioridade), e fallbacks opcionais como
 * Firecrawl (stub desligado nesta etapa). Todos respondem o mesmo contrato,
 * tornando-os intercambiáveis e fáceis de mockar em teste.
 *
 * Garantias do contrato:
 *   - `fetchPage` NUNCA lança: erros viram status 'error'/'timeout'/'blocked'.
 *   - Provider desligado responde status 'disabled' (não tenta rede).
 *   - Nenhuma chave/segredo aparece no resultado.
 *
 * Apenas TIPOS — sem efeito colateral.
 */

export type FetchProviderType = 'native' | 'firecrawl' | 'other';

export type FetchProviderStatus =
  | 'success'
  | 'blocked'
  | 'timeout'
  | 'not_found'
  | 'error'
  | 'disabled';

export interface FetchProviderInput {
  url: string;
  timeoutMs?: number;
}

export interface FetchProviderResult {
  status: FetchProviderStatus;
  url: string;
  finalUrl?: string;
  html?: string;
  text?: string;
  markdown?: string;
  httpStatus?: number;
  errorMessage?: string;
  elapsedMs: number;
}

export interface FetchProvider {
  name: string;
  type: FetchProviderType;
  enabled: boolean;
  fetchPage(input: FetchProviderInput): Promise<FetchProviderResult>;
}

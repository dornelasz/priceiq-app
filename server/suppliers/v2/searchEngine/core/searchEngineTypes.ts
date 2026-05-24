/**
 * searchEngineTypes — tipos de contrato transversais do motor próprio (Etapa 5).
 *
 * Reúne o ENVELOPE de saída do motor (status interno + status público V2 +
 * resultado universal opcional + diagnostics) e re-exporta o `BudgetKind` para
 * import único. Não contém comportamento — apenas contratos. O envelope será
 * produzido pelo pipeline quando ele for implementado em etapa futura; aqui
 * apenas definimos sua forma para o restante do código já tipar contra ela.
 */
import type { UniversalSearchResult } from '../../types.js';
import type { SearchEngineInternalStatus } from './searchEngineStatus.js';
import type { SearchAttempt } from '../diagnostics/searchAttempt.js';

export type { BudgetKind } from './searchBudget.js';

/**
 * Resultado bruto de uma execução do motor próprio.
 *
 *  - `internalStatus`: status interno terminal (rico, para diagnóstico).
 *  - `result`: UniversalSearchResult quando houve produto (validated/partial);
 *    null em falha controlada. Mantém compatibilidade total com o V2 e com o
 *    workerAdapter (que deriva partial vs completo a partir do freightStatus).
 *  - `attempts`: cópia do diagnostics em memória da execução.
 */
export interface SearchEngineOutcome {
  internalStatus: SearchEngineInternalStatus;
  result: UniversalSearchResult | null;
  attempts: SearchAttempt[];
}

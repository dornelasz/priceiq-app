/**
 * Fase 1 do fluxo de duas fases: extrai candidatos de produto a partir da
 * página de busca do fornecedor.
 *
 * Cada candidato tem uma URL absoluta para que a Fase 2 possa abrir a página
 * de produto e extrair o preço com evidência textual.
 *
 * Não usa preços da página de busca como resultado final — eles são opcionais
 * e usados apenas para ranking inicial.
 */
import type { Supplier } from '../services/supplierService.js';
import { extractTopCandidates, type TopCandidate } from './directExtractor.js';

export interface ProductCandidate extends TopCandidate {
  /** URL da página de busca de onde o candidato foi extraído */
  sourceUrl: string;
  /** Posição 0-based na lista de candidatos ordenada por relevância */
  position: number;
}

/**
 * Extrai até `maxCandidates` candidatos com URL de produto a partir do conteúdo
 * de uma página de busca. Ordena por matchScore decrescente.
 *
 * Retorna [] se nenhum candidato com URL absoluta válida for encontrado.
 */
export function extractCandidates(
  supplier: Supplier,
  query: string,
  content: string,
  searchUrl: string,
  maxCandidates = 3,
): ProductCandidate[] {
  const tops = extractTopCandidates(supplier, query, content, searchUrl, maxCandidates);
  return tops.map((c, i) => ({
    ...c,
    sourceUrl: searchUrl,
    position: i,
  }));
}

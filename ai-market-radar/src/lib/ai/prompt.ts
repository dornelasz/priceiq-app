import { CATEGORIES } from "../categories";

export interface AnalysisInput {
  title: string;
  url: string;
  excerpt?: string | null;
  content?: string | null;
}

const ARTICLE_TYPES = [
  "NEWS",
  "LAUNCH",
  "RESEARCH",
  "TOOL",
  "INVESTMENT",
  "REGULATION",
  "PRODUCT_UPDATE",
  "TREND",
  "OPINION",
] as const;

const RELEVANCE_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * Build the analysis prompt. The model receives ONLY the collected text and
 * is explicitly forbidden from inventing facts, links, dates or companies.
 * Output must be strict JSON.
 */
export function buildAnalysisPrompt(input: AnalysisInput): string {
  const content = (input.content ?? input.excerpt ?? "").slice(0, 6000);

  return `Você é um analista do mercado de Inteligência Artificial. Sua tarefa é
RESUMIR e CLASSIFICAR apenas o conteúdo fornecido abaixo.

REGRAS ABSOLUTAS:
- Use SOMENTE as informações presentes no conteúdo fornecido.
- NUNCA invente fatos, números, datas, empresas, produtos, links ou citações.
- Se o conteúdo for insuficiente para um campo, deixe-o vazio ("") ou lista vazia ([]).
- Não inclua URLs que não estejam no conteúdo. A URL oficial já é: ${input.url}
- Responda em português do Brasil.

Responda ESTRITAMENTE com um único objeto JSON válido (sem markdown, sem comentários),
com exatamente estas chaves:
{
  "summary": "resumo objetivo em 2-3 frases, apenas com o que está no conteúdo",
  "impact": "explicação curta do impacto para o mercado de IA / negócios, sem especular além do conteúdo",
  "category": "uma de: ${CATEGORIES.join(" | ")}",
  "relevance": "uma de: ${RELEVANCE_LEVELS.join(" | ")}",
  "articleType": "uma de: ${ARTICLE_TYPES.join(" | ")}",
  "companies": ["empresas explicitamente citadas no conteúdo"],
  "technologies": ["tecnologias/modelos explicitamente citados"],
  "keywords": ["3 a 8 palavras-chave do conteúdo"]
}

CONTEÚDO COLETADO:
Título: ${input.title}
Texto: ${content || "(sem corpo de texto; baseie-se apenas no título)"}
`;
}

export { ARTICLE_TYPES, RELEVANCE_LEVELS };

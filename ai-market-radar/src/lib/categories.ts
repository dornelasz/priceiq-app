// Canonical category list for AI Market Radar.
// Categories are app constants (single source of truth), used to tag
// sources and AI analyses, and to drive dashboard filters.

export const CATEGORIES = [
  "Modelos de IA",
  "Ferramentas de IA",
  "Automação",
  "Agentes de IA",
  "Big Techs",
  "Startups",
  "Investimentos",
  "Papers e pesquisa",
  "Open source",
  "Hardware e chips",
  "Regulação",
  "IA para negócios",
  "IA para e-commerce",
  "Segurança e privacidade",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(CATEGORIES);

export function isValidCategory(value: string | null | undefined): value is Category {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

// Map an arbitrary string (e.g. AI output) to the closest known category,
// falling back to a sensible default. Never invents a new category.
export function normalizeCategory(value: string | null | undefined): Category {
  if (isValidCategory(value)) return value;
  if (!value) return "Modelos de IA";
  const lower = value.toLowerCase().trim();
  const match = CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (match) return match;
  // Loose keyword routing for common synonyms.
  if (/(agent|agente)/.test(lower)) return "Agentes de IA";
  if (/(tool|ferramenta)/.test(lower)) return "Ferramentas de IA";
  if (/(model|modelo|llm)/.test(lower)) return "Modelos de IA";
  if (/(paper|research|pesquisa|arxiv)/.test(lower)) return "Papers e pesquisa";
  if (/(open.?source|código aberto)/.test(lower)) return "Open source";
  if (/(chip|gpu|hardware|nvidia)/.test(lower)) return "Hardware e chips";
  if (/(regula|policy|lei)/.test(lower)) return "Regulação";
  if (/(invest|funding|round|aporte)/.test(lower)) return "Investimentos";
  if (/(startup)/.test(lower)) return "Startups";
  if (/(ecommerce|e-commerce|varejo|retail)/.test(lower)) return "IA para e-commerce";
  if (/(security|privac|segurança)/.test(lower)) return "Segurança e privacidade";
  if (/(automation|automação|workflow)/.test(lower)) return "Automação";
  if (/(business|negócio|enterprise|empresa)/.test(lower)) return "IA para negócios";
  return "Modelos de IA";
}

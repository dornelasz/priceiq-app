import { loadEnv } from "../src/lib/loadEnv";
loadEnv();

import type { SourceType } from "@prisma/client";
import { CATEGORIES } from "../src/lib/categories";
import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

interface SeedSource {
  name: string;
  url: string;
  type: SourceType;
  category: string;
  isActive: boolean;
  note?: string;
}

// Only public, well-known sources. Feeds with a confident public RSS/Atom are
// active; sources without a confirmed stable public feed are registered but
// INACTIVE (no broken collectors auto-run). Verify a feed, then activate it
// from the "Fontes" page. We never invent content — only register sources.
const SEED_SOURCES: SeedSource[] = [
  // ── Verified public RSS/Atom feeds (active) ──────────────────────────
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", type: "RSS", category: "Open source", isActive: true },
  { name: "arXiv cs.AI", url: "http://export.arxiv.org/rss/cs.AI", type: "PAPER", category: "Papers e pesquisa", isActive: true },
  { name: "arXiv cs.LG", url: "http://export.arxiv.org/rss/cs.LG", type: "PAPER", category: "Papers e pesquisa", isActive: true },
  { name: "The Decoder", url: "https://the-decoder.com/feed/", type: "RSS", category: "Modelos de IA", isActive: true },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", type: "RSS", category: "IA para negócios", isActive: true },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", type: "RSS", category: "Startups", isActive: true },
  { name: "NVIDIA Blog", url: "https://blogs.nvidia.com/feed/", type: "RSS", category: "Hardware e chips", isActive: true },
  { name: "Microsoft AI Blog", url: "https://blogs.microsoft.com/ai/feed/", type: "RSS", category: "Big Techs", isActive: true },
  { name: "MIT Technology Review — AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", type: "RSS", category: "Papers e pesquisa", isActive: true },
  { name: "Google — The Keyword (AI)", url: "https://blog.google/technology/ai/rss/", type: "RSS", category: "Big Techs", isActive: true },
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml", type: "RSS", category: "Modelos de IA", isActive: true },

  // ── Registered but INACTIVE (confirm a public feed before activating) ─
  { name: "Anthropic News", url: "https://www.anthropic.com/news", type: "SITE", category: "Modelos de IA", isActive: false, note: "Confirmar RSS/feed público antes de ativar." },
  { name: "Meta AI Blog", url: "https://ai.meta.com/blog/", type: "SITE", category: "Big Techs", isActive: false, note: "Confirmar RSS/feed público antes de ativar." },
  { name: "Product Hunt — AI", url: "https://www.producthunt.com/topics/artificial-intelligence", type: "SITE", category: "Ferramentas de IA", isActive: false, note: "Sem RSS público estável confirmado; verificar antes de ativar." },
  { name: "GitHub Trending", url: "https://github.com/trending", type: "GITHUB", category: "Open source", isActive: false, note: "Sem API/feed oficial de trending; coletor GitHub não implementado." },
];

const EXAMPLE_ALERTS = [
  { name: "OpenAI", company: "OpenAI", keyword: null, category: null },
  { name: "Gemini", company: null, keyword: "Gemini", category: null },
  { name: "Claude", company: null, keyword: "Claude", category: null },
  { name: "Agentes de IA", company: null, keyword: null, category: "Agentes de IA" },
  { name: "IA para e-commerce", company: null, keyword: null, category: "IA para e-commerce" },
  { name: "Automação", company: null, keyword: "automação", category: "Automação" },
];

async function main(): Promise<void> {
  console.log(`Categorias disponíveis (${CATEGORIES.length}): ${CATEGORIES.join(", ")}`);

  // Demo user (no password — auth structure is prepared, not enabled in V1).
  const user = await prisma.user.upsert({
    where: { email: "demo@ai-market-radar.local" },
    update: {},
    create: { email: "demo@ai-market-radar.local", name: "Demo" },
  });

  let active = 0;
  for (const s of SEED_SOURCES) {
    await prisma.source.upsert({
      where: { url: s.url },
      update: { name: s.name, type: s.type, category: s.category, isActive: s.isActive },
      create: {
        name: s.name,
        url: s.url,
        type: s.type,
        category: s.category,
        isActive: s.isActive,
        fetchIntervalMinutes: env.defaultFetchIntervalMinutes,
        lastError: s.note ?? null,
      },
    });
    if (s.isActive) active += 1;
  }
  console.log(`Fontes: ${SEED_SOURCES.length} cadastradas (${active} ativas).`);

  const existingAlerts = await prisma.alert.count();
  if (existingAlerts === 0) {
    for (const a of EXAMPLE_ALERTS) {
      await prisma.alert.create({
        data: {
          name: a.name,
          keyword: a.keyword,
          company: a.company,
          category: a.category,
          minRelevance: "LOW",
          isActive: true,
          userId: user.id,
        },
      });
    }
    console.log(`Alertas de exemplo criados: ${EXAMPLE_ALERTS.length}.`);
  } else {
    console.log(`Alertas já existem (${existingAlerts}); nenhum criado.`);
  }

  console.log(
    "\nNenhuma notícia fictícia foi criada. Rode `npm run fetch:once` (requer rede) ou inicie o worker para coletar conteúdo real.",
  );

  if (env.runFetchOnSeed) {
    console.log("\nRUN_FETCH_ON_SEED=true — coletando agora…");
    const { runAllActive } = await import("../src/lib/services/fetchRunner");
    const summary = await runAllActive();
    console.log(`Coleta: novas=${summary.created} analisadas=${summary.analyzed} falhas=${summary.failures}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Seed falhou:", err);
    await prisma.$disconnect();
    process.exit(1);
  });

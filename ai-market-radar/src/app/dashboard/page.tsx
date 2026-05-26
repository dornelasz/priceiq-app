import Link from "next/link";
import type { Prisma, Relevance } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scoreToRelevance, relevanceRank } from "@/lib/relevance";
import { timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/Shell";
import { CollectNowButton } from "@/components/CollectNowButton";
import { SearchForm } from "@/components/SearchForm";
import { CategoryChips } from "@/components/CategoryChips";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { EmptyState, ErrorState, Pill, SectionHeader, StatCard } from "@/components/ui";
import {
  IconBuilding,
  IconNews,
  IconRss,
  IconSpark,
  IconTrend,
} from "@/components/Icons";

export const dynamic = "force-dynamic";

type RecentArticle = Prisma.ArticleGetPayload<{
  include: { source: { select: { name: true } }; analysis: true };
}>;

function effectiveRelevance(a: RecentArticle): Relevance {
  return a.analysis?.relevance ?? scoreToRelevance(a.localScore);
}

function tally(items: string[]): Array<{ term: string; count: number }> {
  const m = new Map<string, { term: string; count: number }>();
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    const e = m.get(k);
    if (e) e.count += 1;
    else m.set(k, { term: t, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { category?: string; q?: string };
}) {
  const category = searchParams.category?.trim() || undefined;
  const q = searchParams.q?.trim() || undefined;

  const and: Prisma.ArticleWhereInput[] = [];
  if (category) and.push({ analysis: { category } });
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { rawExcerpt: { contains: q, mode: "insensitive" } },
        { analysis: { summary: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const baseWhere: Prisma.ArticleWhereInput = and.length ? { AND: and } : {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let data;
  try {
    const [total, analyzed, pending, activeSources, lastFetch, recent, today] = await Promise.all([
      prisma.article.count(),
      prisma.article.count({ where: { status: "ANALYZED" } }),
      prisma.article.count({ where: { status: "PENDING_ANALYSIS" } }),
      prisma.source.count({ where: { isActive: true } }),
      prisma.fetchLog.findFirst({
        orderBy: { startedAt: "desc" },
        include: { source: { select: { name: true } } },
      }),
      prisma.article.findMany({
        where: baseWhere,
        orderBy: { collectedAt: "desc" },
        take: 120,
        include: { source: { select: { name: true } }, analysis: true },
      }),
      prisma.article.findMany({
        where: { ...baseWhere, collectedAt: { gte: todayStart } },
        orderBy: [{ localScore: "desc" }, { collectedAt: "desc" }],
        take: 6,
        include: { source: { select: { name: true } }, analysis: true },
      }),
    ]);
    data = { total, analyzed, pending, activeSources, lastFetch, recent, today };
  } catch (err) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Visão geral do mercado de IA" />
        <ErrorState
          message={`Não foi possível ler o banco de dados. Rode as migrations (npm run prisma:migrate) e confira a DATABASE_URL. Detalhe: ${
            err instanceof Error ? err.message : String(err)
          }`}
        />
      </>
    );
  }

  const { total, analyzed, pending, activeSources, lastFetch, recent, today } = data;

  const important = [...recent]
    .sort((a, b) => {
      const r = relevanceRank(effectiveRelevance(b)) - relevanceRank(effectiveRelevance(a));
      return r !== 0 ? r : b.localScore - a.localScore;
    })
    .slice(0, 6);
  const trends = tally(
    recent.flatMap((a) => [...(a.analysis?.keywords ?? []), ...(a.analysis?.technologies ?? [])]),
  ).slice(0, 10);
  const companies = tally(recent.flatMap((a) => a.analysis?.companies ?? []))
    .slice(0, 8)
    .map((c) => ({ name: c.term, count: c.count }));
  const tools = recent.filter((a) => a.analysis?.articleType === "TOOL").slice(0, 6);

  const hasAnyData = total > 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do mercado de IA em tempo real"
        action={
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-xs text-zinc-500">
              Última coleta:{" "}
              <span className="text-zinc-300">
                {lastFetch ? `${timeAgo(lastFetch.startedAt)} · ${lastFetch.source.name}` : "nunca"}
              </span>
            </span>
            <CollectNowButton />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Notícias" value={total} icon={<IconNews width={18} height={18} />} />
        <StatCard label="Analisadas (IA)" value={analyzed} icon={<IconSpark width={18} height={18} />} />
        <StatCard
          label="Pendentes"
          value={pending}
          hint={pending > 0 ? "aguardando análise de IA" : undefined}
          icon={<IconTrend width={18} height={18} />}
        />
        <StatCard label="Fontes ativas" value={activeSources} icon={<IconRss width={18} height={18} />} />
      </div>

      <div className="mt-6 space-y-3">
        <SearchForm basePath="/dashboard" />
        <CategoryChips basePath="/dashboard" active={category} extraParams={{ q }} />
      </div>

      {!hasAnyData ? (
        <div className="mt-6">
          <EmptyState
            icon={<IconRss width={40} height={40} />}
            title="Nenhuma notícia coletada ainda"
            description="Cadastre fontes com RSS/feeds públicos e clique em “Coletar agora”. Nada é inventado: o painel só mostra conteúdo realmente coletado."
            action={
              <div className="flex gap-2">
                <Link href="/sources" className="btn-ghost">
                  Gerenciar fontes
                </Link>
                <CollectNowButton />
              </div>
            }
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <section>
            <SectionHeader
              title="Principais notícias do dia"
              icon={<IconNews width={16} height={16} />}
              description="Coletadas hoje, ordenadas por relevância"
            />
            {today.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {today.map((a) => (
                  <ArticleCard key={a.id} article={a as ArticleCardData} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconNews width={36} height={36} />}
                title="Nada coletado hoje ainda"
                description="As notícias mais recentes aparecem abaixo em “Mais importantes”."
              />
            )}
          </section>

          <section>
            <SectionHeader
              title="Mais importantes"
              icon={<IconTrend width={16} height={16} />}
              description="Maior relevância nas últimas coletas"
              action={
                <Link href="/articles?relevance=HIGH" className="text-xs text-brand-soft hover:underline">
                  Ver todas →
                </Link>
              }
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {important.map((a) => (
                <ArticleCard key={a.id} article={a as ArticleCardData} />
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <SectionHeader title="Tendências em alta" icon={<IconTrend width={16} height={16} />} />
              {trends.length ? (
                <div className="card flex flex-wrap gap-2 p-4">
                  {trends.map((t) => (
                    <Link key={t.term} href={`/articles?q=${encodeURIComponent(t.term)}`}>
                      <Pill className="hover:border-brand/40">
                        {t.term} <span className="text-zinc-500">·{t.count}</span>
                      </Pill>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<IconTrend width={32} height={32} />}
                  title="Sem tendências ainda"
                  description="As tendências surgem após a análise de IA das notícias coletadas."
                />
              )}
            </section>

            <section>
              <SectionHeader title="Empresas mais citadas" icon={<IconBuilding width={16} height={16} />} />
              {companies.length ? (
                <div className="card flex flex-wrap gap-2 p-4">
                  {companies.map((c) => (
                    <Link key={c.name} href={`/articles?company=${encodeURIComponent(c.name)}`}>
                      <Pill className="hover:border-brand/40">
                        {c.name} <span className="text-zinc-500">·{c.count}</span>
                      </Pill>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<IconBuilding width={32} height={32} />}
                  title="Sem empresas detectadas"
                  description="Empresas citadas aparecem após a análise de IA."
                />
              )}
            </section>
          </div>

          <section>
            <SectionHeader title="Novas ferramentas de IA" icon={<IconSpark width={16} height={16} />} />
            {tools.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tools.map((a) => (
                  <ArticleCard key={a.id} article={a as ArticleCardData} compact />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconSpark width={32} height={32} />}
                title="Nenhuma ferramenta detectada"
                description="Notícias classificadas como “Ferramenta” pela IA aparecem aqui."
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}

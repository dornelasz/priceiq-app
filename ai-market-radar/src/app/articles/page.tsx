import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildArticleWhere } from "@/lib/articleQuery";
import { clampInt } from "@/lib/validation";
import { PageHeader } from "@/components/Shell";
import { SearchForm } from "@/components/SearchForm";
import { CategoryChips } from "@/components/CategoryChips";
import { ArticleFilters } from "@/components/ArticleFilters";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { EmptyState, ErrorState } from "@/components/ui";
import { IconNews } from "@/components/Icons";

export const dynamic = "force-dynamic";

function toParams(searchParams: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string" && v) p.set(k, v);
  }
  return p;
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = toParams(searchParams);
  const page = clampInt(params.get("page"), 1, 1, 100000);
  const pageSize = 24;
  const where = buildArticleWhere(params);

  let sources: Array<{ id: string; name: string }> = [];
  let items: ArticleCardData[] = [];
  let total = 0;
  let failed: string | null = null;

  try {
    const [src, list, count] = await Promise.all([
      prisma.source.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.article.findMany({
        where,
        orderBy: [{ localScore: "desc" }, { collectedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { source: { select: { name: true } }, analysis: true },
      }),
      prisma.article.count({ where }),
    ]);
    sources = src;
    items = list as ArticleCardData[];
    total = count;
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const category = params.get("category") ?? undefined;
  const q = params.get("q") ?? undefined;

  function pageHref(p: number): string {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `/articles?${next.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="Notícias"
        subtitle={failed ? undefined : `${total} notícia(s) — fonte, URL e data rastreáveis`}
      />

      <div className="space-y-3">
        <SearchForm basePath="/articles" />
        <CategoryChips basePath="/articles" active={category} extraParams={{ q }} />
        <ArticleFilters sources={sources} />
      </div>

      {failed ? (
        <div className="mt-6">
          <ErrorState
            message={`Não foi possível ler o banco. Rode as migrations e confira a DATABASE_URL. Detalhe: ${failed}`}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<IconNews width={40} height={40} />}
            title="Nenhuma notícia encontrada"
            description="Ajuste os filtros ou colete novas notícias. O painel só exibe conteúdo realmente coletado de fontes reais."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>

          {pageCount > 1 ? (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="btn-ghost">
                  ← Anterior
                </Link>
              ) : (
                <span className="btn-ghost opacity-40">← Anterior</span>
              )}
              <span className="text-zinc-500">
                Página {page} de {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={pageHref(page + 1)} className="btn-ghost">
                  Próxima →
                </Link>
              ) : (
                <span className="btn-ghost opacity-40">Próxima →</span>
              )}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

import Link from "next/link";
import type { ArticleType, Relevance } from "@prisma/client";
import { ARTICLE_TYPE_LABEL, formatDate, hostOf, timeAgo } from "@/lib/format";
import { Pill, RelevanceBadge } from "@/components/ui";
import { IconExternal } from "@/components/Icons";

export interface ArticleCardData {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | string | null;
  collectedAt: Date | string;
  rawExcerpt: string | null;
  status: string;
  source: { name: string };
  analysis: {
    summary: string;
    category: string;
    relevance: Relevance;
    articleType: ArticleType;
  } | null;
}

export function ArticleCard({ article, compact = false }: { article: ArticleCardData; compact?: boolean }) {
  const a = article;
  const blurb = a.analysis?.summary ?? a.rawExcerpt ?? null;
  const pending = !a.analysis;

  return (
    <article className="card card-hover flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {a.analysis ? (
          <RelevanceBadge relevance={a.analysis.relevance} />
        ) : (
          <Pill className="border-amber-500/30 bg-amber-500/10 text-amber-400">
            Pendente de análise
          </Pill>
        )}
        {a.analysis?.category ? <Pill>{a.analysis.category}</Pill> : null}
        {a.analysis?.articleType ? (
          <Pill className="text-zinc-400">{ARTICLE_TYPE_LABEL[a.analysis.articleType]}</Pill>
        ) : null}
      </div>

      <Link href={`/articles/${a.id}`} className="group">
        <h3 className="text-[15px] font-semibold leading-snug text-zinc-100 group-hover:text-white">
          {a.title}
        </h3>
      </Link>

      {blurb && !compact ? (
        <p className="line-clamp-3 text-sm text-zinc-400">{blurb}</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-zinc-500">
        <span className="truncate">
          {a.source.name} · {hostOf(a.url)}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span title={formatDate(a.publishedAt ?? a.collectedAt)}>
            {timeAgo(a.publishedAt ?? a.collectedAt)}
          </span>
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-brand-soft"
            title="Abrir fonte original"
          >
            Fonte <IconExternal width={13} height={13} />
          </a>
        </span>
      </div>
      {pending ? null : null}
    </article>
  );
}

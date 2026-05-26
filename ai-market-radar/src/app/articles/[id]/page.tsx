import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isAiConfigured } from "@/lib/ai/gemini";
import { ARTICLE_TYPE_LABEL, formatDateTime, hostOf, SOURCE_TYPE_LABEL } from "@/lib/format";
import { PageHeader } from "@/components/Shell";
import { AnalyzeButton } from "@/components/AnalyzeButton";
import { Pill, RelevanceBadge } from "@/components/ui";
import { IconExternal } from "@/components/Icons";

export const dynamic = "force-dynamic";

function Chips({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <Pill key={v}>{v}</Pill>
        ))}
      </div>
    </div>
  );
}

export default async function ArticleDetailPage({ params }: { params: { id: string } }) {
  const article = await prisma.article.findUnique({
    where: { id: params.id },
    include: {
      source: { select: { id: true, name: true, type: true } },
      analysis: true,
    },
  });

  if (!article) notFound();
  const a = article;
  const analysis = a.analysis;

  return (
    <>
      <PageHeader
        title="Detalhe da notícia"
        action={
          <Link href="/articles" className="btn-ghost">
            ← Voltar
          </Link>
        }
      />

      <article className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {analysis ? (
            <RelevanceBadge relevance={analysis.relevance} />
          ) : (
            <Pill className="border-amber-500/30 bg-amber-500/10 text-amber-400">
              Pendente de análise
            </Pill>
          )}
          {analysis?.category ? <Pill>{analysis.category}</Pill> : null}
          {analysis?.articleType ? (
            <Pill className="text-zinc-400">{ARTICLE_TYPE_LABEL[analysis.articleType]}</Pill>
          ) : null}
        </div>

        <h2 className="mt-3 text-xl font-semibold leading-tight text-white sm:text-2xl">
          {a.title}
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
          <Link href={`/articles?sourceId=${a.source.id}`} className="hover:text-zinc-300">
            {a.source.name}{" "}
            <span className="text-zinc-600">· {SOURCE_TYPE_LABEL[a.source.type]}</span>
          </Link>
          <span className="text-zinc-600">{hostOf(a.url)}</span>
          {a.author ? <span>por {a.author}</span> : null}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
          <span>Publicado: {formatDateTime(a.publishedAt)}</span>
          <span>Coletado: {formatDateTime(a.collectedAt)}</span>
        </div>

        <div className="mt-4">
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost w-fit"
          >
            Abrir fonte original <IconExternal width={15} height={15} />
          </a>
        </div>

        <hr className="my-5 border-border" />

        {analysis ? (
          <div className="space-y-5">
            <section>
              <p className="label">Resumo (IA · {analysis.aiModel})</p>
              <p className="text-sm leading-relaxed text-zinc-200">{analysis.summary}</p>
            </section>
            {analysis.impact ? (
              <section>
                <p className="label">Impacto</p>
                <p className="text-sm leading-relaxed text-zinc-300">{analysis.impact}</p>
              </section>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <Chips label="Empresas citadas" values={analysis.companies} />
              <Chips label="Tecnologias" values={analysis.technologies} />
              <Chips label="Palavras-chave" values={analysis.keywords} />
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm text-amber-300">Esta notícia ainda não foi analisada pela IA.</p>
            <p className="mt-1 text-xs text-zinc-400">
              {isAiConfigured()
                ? "A análise resume e classifica apenas o conteúdo coletado — nada é inventado."
                : "Configure a GEMINI_API_KEY para habilitar a análise. O sistema funciona normalmente sem ela."}
            </p>
            {isAiConfigured() ? (
              <div className="mt-3">
                <AnalyzeButton articleId={a.id} />
              </div>
            ) : null}
          </div>
        )}

        {a.rawExcerpt || a.rawContent ? (
          <>
            <hr className="my-5 border-border" />
            <section>
              <p className="label">Conteúdo original coletado (trecho)</p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
                {(a.rawContent ?? a.rawExcerpt ?? "").slice(0, 2000)}
              </p>
            </section>
          </>
        ) : null}
      </article>
    </>
  );
}

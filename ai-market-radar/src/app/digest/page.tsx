import Link from "next/link";
import { generateDigest } from "@/lib/services/digestService";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/Shell";
import { GenerateDigestButton } from "@/components/GenerateDigestButton";
import { EmptyState, ErrorState, Pill, RelevanceBadge, SectionHeader } from "@/components/ui";
import { IconBuilding, IconDigest, IconSpark, IconTrend } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function DigestPage() {
  let digest;
  let failed: string | null = null;
  try {
    digest = await generateDigest(new Date());
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
  }

  if (failed) {
    return (
      <>
        <PageHeader title="Resumo Diário" subtitle="Gerado a partir das notícias coletadas hoje" />
        <ErrorState
          message={`Não foi possível gerar o resumo. Rode as migrations e confira a DATABASE_URL. Detalhe: ${failed}`}
        />
      </>
    );
  }

  const d = digest!;

  return (
    <>
      <PageHeader
        title="Resumo Diário"
        subtitle={`${formatDate(new Date())} · gerado apenas com as notícias salvas hoje`}
        action={<GenerateDigestButton />}
      />

      {d.totalArticles === 0 ? (
        <EmptyState
          icon={<IconDigest width={40} height={40} />}
          title="Nenhuma notícia coletada hoje"
          description="O resumo diário usa somente as notícias realmente coletadas no dia. Cadastre fontes e colete para gerar o resumo."
          action={
            <Link href="/sources" className="btn-ghost">
              Gerenciar fontes
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="card p-5">
            <p className="text-sm leading-relaxed text-zinc-300">{d.summary}</p>
          </div>

          <section>
            <SectionHeader title="Top 5 notícias do dia" icon={<IconDigest width={16} height={16} />} />
            <ol className="space-y-2">
              {d.topArticles.map((t, i) => (
                <li key={t.id} className="card card-hover flex items-start gap-3 p-4">
                  <span className="text-lg font-semibold text-brand-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/articles/${t.id}`} className="font-medium text-zinc-100 hover:text-white">
                      {t.title}
                    </Link>
                    {t.summary ? (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{t.summary}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <RelevanceBadge relevance={t.relevance} />
                      {t.category ? <Pill>{t.category}</Pill> : null}
                      <span>{t.sourceName}</span>
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-soft hover:underline"
                      >
                        link original
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <SectionHeader title="Top tendências" icon={<IconTrend width={16} height={16} />} />
              <div className="card flex flex-wrap gap-2 p-4">
                {d.trends.length ? (
                  d.trends.map((t) => (
                    <Pill key={t.term}>
                      {t.term} <span className="text-zinc-500">·{t.count}</span>
                    </Pill>
                  ))
                ) : (
                  <span className="text-xs text-zinc-500">Sem tendências (requer análise de IA).</span>
                )}
              </div>
            </section>
            <section>
              <SectionHeader title="Empresas mais citadas" icon={<IconBuilding width={16} height={16} />} />
              <div className="card flex flex-wrap gap-2 p-4">
                {d.companies.length ? (
                  d.companies.map((c) => (
                    <Pill key={c.name}>
                      {c.name} <span className="text-zinc-500">·{c.count}</span>
                    </Pill>
                  ))
                ) : (
                  <span className="text-xs text-zinc-500">Sem empresas (requer análise de IA).</span>
                )}
              </div>
            </section>
          </div>

          <section>
            <SectionHeader title="Novas ferramentas detectadas" icon={<IconSpark width={16} height={16} />} />
            {d.newTools.length ? (
              <ul className="space-y-2">
                {d.newTools.map((t) => (
                  <li key={t.id} className="card flex items-center justify-between gap-3 p-3 text-sm">
                    <Link href={`/articles/${t.id}`} className="truncate text-zinc-200 hover:text-white">
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-xs text-zinc-500">{t.sourceName}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">Nenhuma ferramenta classificada hoje.</p>
            )}
          </section>

          {d.businessImpacts.length ? (
            <section>
              <SectionHeader title="Principais impactos para negócios" icon={<IconTrend width={16} height={16} />} />
              <ul className="space-y-2">
                {d.businessImpacts.map((b) => (
                  <li key={b.id} className="card p-4">
                    <Link href={`/articles/${b.id}`} className="text-sm font-medium text-zinc-100 hover:text-white">
                      {b.title}
                    </Link>
                    <p className="mt-1 text-sm text-zinc-400">{b.impact}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

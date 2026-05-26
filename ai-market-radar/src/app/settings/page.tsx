import { isAiConfigured } from "@/lib/ai/gemini";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/Shell";
import { TestAiButton } from "@/components/TestAiButton";
import { Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const aiOn = isAiConfigured();

  let stats: {
    sources: number;
    active: number;
    articles: number;
    analyzed: number;
    pending: number;
    lastFetchAt: Date | null;
  } | null = null;
  let failed: string | null = null;

  try {
    const [sources, active, articles, analyzed, pending, lastFetch] = await Promise.all([
      prisma.source.count(),
      prisma.source.count({ where: { isActive: true } }),
      prisma.article.count(),
      prisma.article.count({ where: { status: "ANALYZED" } }),
      prisma.article.count({ where: { status: "PENDING_ANALYSIS" } }),
      prisma.fetchLog.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);
    stats = { sources, active, articles, analyzed, pending, lastFetchAt: lastFetch?.startedAt ?? null };
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <PageHeader title="Configurações" subtitle="Status do sistema e da integração de IA" />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Gemini API</h2>
            {aiOn ? (
              <Pill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                Configurada
              </Pill>
            ) : (
              <Pill className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                Não configurada
              </Pill>
            )}
          </div>
          <Row label="Modelo" value={<code className="text-xs">{env.geminiModel}</code>} />
          <Row label="Chave (GEMINI_API_KEY)" value={aiOn ? "definida via ambiente" : "ausente"} />
          <p className="my-3 text-xs leading-relaxed text-zinc-500">
            A chave é lida apenas de variável de ambiente — nunca fica no código. Sem chave, o
            sistema continua funcionando: as notícias são salvas com status “pendente de análise”.
          </p>
          <TestAiButton />
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Coleta automática</h2>
          <Row label="Cron de coleta (worker)" value={<code className="text-xs">{env.workerFetchCron}</code>} />
          <Row label="Cron do resumo diário" value={<code className="text-xs">{env.workerDigestCron}</code>} />
          <Row label="Fuso horário" value={env.timezone} />
          <Row label="Intervalo padrão por fonte" value={`${env.defaultFetchIntervalMinutes} min`} />
          <Row label="Analisar ao coletar" value={env.analyzeOnFetch ? "sim" : "não"} />
          <Row label="Máx. análises por ciclo" value={env.maxAnalyzePerRun} />
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            Os intervalos do worker são definidos por variáveis de ambiente. O intervalo de cada
            fonte é ajustado na página <strong className="text-zinc-300">Fontes</strong>.
          </p>
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Informações do sistema</h2>
          {failed ? (
            <p className="text-sm text-relevance-critical">
              Banco indisponível ({failed}). Rode <code>npm run prisma:migrate</code>.
            </p>
          ) : stats ? (
            <div className="grid gap-x-8 sm:grid-cols-2">
              <Row label="Fontes cadastradas" value={stats.sources} />
              <Row label="Fontes ativas" value={stats.active} />
              <Row label="Notícias coletadas" value={stats.articles} />
              <Row label="Analisadas pela IA" value={stats.analyzed} />
              <Row label="Pendentes de análise" value={stats.pending} />
              <Row
                label="Última coleta"
                value={stats.lastFetchAt ? formatDateTime(stats.lastFetchAt) : "nunca"}
              />
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}

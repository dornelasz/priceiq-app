import { prisma } from "@/lib/prisma";
import { findMatchesForAlert } from "@/lib/services/alertService";
import { PageHeader } from "@/components/Shell";
import { AlertManager, type AlertWithMatches } from "@/components/AlertManager";
import { ErrorState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  let alerts: AlertWithMatches[] = [];
  let failed: string | null = null;

  try {
    const rows = await prisma.alert.findMany({ orderBy: { createdAt: "desc" } });
    alerts = await Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        name: a.name,
        keyword: a.keyword,
        company: a.company,
        category: a.category,
        minRelevance: a.minRelevance,
        isActive: a.isActive,
        matches: a.isActive ? await findMatchesForAlert(a, 8) : [],
      })),
    );
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <PageHeader
        title="Alertas"
        subtitle="Monitore palavras-chave, empresas e categorias. Notícias que batem aparecem abaixo."
      />
      {failed ? (
        <ErrorState
          message={`Não foi possível ler o banco. Rode as migrations e confira a DATABASE_URL. Detalhe: ${failed}`}
        />
      ) : (
        <AlertManager initialAlerts={alerts} />
      )}
    </>
  );
}

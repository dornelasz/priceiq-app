import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/Shell";
import { SourceManager, type SourceRow } from "@/components/SourceManager";
import { ErrorState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  let sources: SourceRow[] = [];
  let failed: string | null = null;
  try {
    sources = (await prisma.source.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { articles: true } } },
    })) as unknown as SourceRow[];
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <PageHeader
        title="Fontes"
        subtitle="Gerencie fontes públicas (RSS, blogs oficiais, páginas, papers). A coleta é automática."
      />
      {failed ? (
        <ErrorState
          message={`Não foi possível ler o banco. Rode as migrations e confira a DATABASE_URL. Detalhe: ${failed}`}
        />
      ) : (
        <SourceManager initialSources={sources} />
      )}
    </>
  );
}

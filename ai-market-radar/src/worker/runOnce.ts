import { loadEnv } from "../lib/loadEnv";
loadEnv();

import { errorMessage } from "../lib/async";
import { prisma } from "../lib/prisma";
import { runAllActive } from "../lib/services/fetchRunner";

// One-shot collection across every active source. Useful from the CLI / Docker.
async function main(): Promise<void> {
  console.log("Coletando de todas as fontes ativas…");
  try {
    const summary = await runAllActive();
    console.log(
      `Concluído: fontes=${summary.sources} novas=${summary.created} analisadas=${summary.analyzed} dups=${summary.duplicates} falhas=${summary.failures}`,
    );
    for (const r of summary.results) {
      const tag = r.status === "ERROR" ? "ERRO" : r.status;
      console.log(
        ` - [${tag}] ${r.sourceName}: encontradas=${r.found} novas=${r.created}${
          r.error ? ` (${r.error})` : ""
        }`,
      );
    }
  } catch (err) {
    console.error("Falha geral na coleta:", errorMessage(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

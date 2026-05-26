import { loadEnv } from "../lib/loadEnv";
loadEnv();

import cron from "node-cron";
import { errorMessage } from "../lib/async";
import { env } from "../lib/env";
import { prisma } from "../lib/prisma";
import { generateDigest } from "../lib/services/digestService";
import { runDueSources } from "../lib/services/fetchRunner";

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), "[worker]", ...args);
}

async function fetchTick(): Promise<void> {
  try {
    const s = await runDueSources();
    log(
      `coleta: fontes=${s.sources} novas=${s.created} analisadas=${s.analyzed} dups=${s.duplicates} falhas=${s.failures}`,
    );
  } catch (err) {
    log("erro no ciclo de coleta:", errorMessage(err));
  }
}

async function digestTick(): Promise<void> {
  try {
    const d = await generateDigest(new Date());
    log(`resumo diário gerado: ${d.totalArticles} notícia(s)`);
  } catch (err) {
    log("erro ao gerar resumo diário:", errorMessage(err));
  }
}

function main(): void {
  log(
    `iniciando — fetchCron="${env.workerFetchCron}" digestCron="${env.workerDigestCron}" tz="${env.timezone}" ia=${env.isAiConfigured ? "on" : "off"}`,
  );

  if (!cron.validate(env.workerFetchCron)) {
    log(`WORKER_FETCH_CRON inválido: "${env.workerFetchCron}". Encerrando.`);
    process.exit(1);
  }
  cron.schedule(env.workerFetchCron, fetchTick, { timezone: env.timezone });

  if (cron.validate(env.workerDigestCron)) {
    cron.schedule(env.workerDigestCron, digestTick, { timezone: env.timezone });
  } else {
    log(`WORKER_DIGEST_CRON inválido: "${env.workerDigestCron}". Resumo diário desabilitado.`);
  }

  // First collection shortly after boot so the dashboard fills up quickly.
  setTimeout(() => void fetchTick(), 2000);

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log(`recebido ${sig}, encerrando…`);
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  }
}

main();

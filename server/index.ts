/**
 * PriceIQ Server — Fastify entry point.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';

import { config } from './config.js';
import { isAppError } from './lib/errors.js';
import { suppliersRoutes } from './routes/suppliers.js';
import { searchesRoutes } from './routes/searches.js';
import { resultsRoutes } from './routes/results.js';
import { ratesRoutes } from './routes/rates.js';
import { cacheService } from './services/cacheService.js';
import { databaseService } from './services/databaseService.js';
import { closePool } from './db/client.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  },
  bodyLimit: 1_000_000,
  trustProxy: true,
});

await app.register(cors, {
  origin: config.FRONTEND_URL === '*' ? true : [config.FRONTEND_URL, /^http:\/\/localhost:\d+$/],
  credentials: true,
});
await app.register(sensible);

// ─── Health checks ──────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok',
  ts: new Date().toISOString(),
  redis: cacheService.isHealthy(),
}));

app.get('/api/health', async () => ({
  status: 'ok',
  env: config.NODE_ENV,
  ts: new Date().toISOString(),
}));

app.get('/api/db/health', async () => databaseService.health());

// ─── Routes ─────────────────────────────────────────────
await app.register(suppliersRoutes);
await app.register(searchesRoutes);
await app.register(resultsRoutes);
await app.register(ratesRoutes);

// ─── Error handler ──────────────────────────────────────
app.setErrorHandler((error, req, reply) => {
  // Zod validation
  if (error instanceof ZodError) {
    reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Entrada inválida',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  // Erros tipados
  if (isAppError(error)) {
    reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
    return;
  }

  req.log.error({ err: error }, 'unhandled error');
  reply.code(error.statusCode ?? 500).send({
    error: 'INTERNAL_ERROR',
    message: error.message || 'Erro interno',
  });
});

// ─── Shutdown limpo ─────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down…');
  try {
    await app.close();
  } catch (e) {
    app.log.error({ err: e }, 'erro ao fechar fastify');
  }
  await cacheService.close().catch(() => {});
  await closePool();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// ─── Start ──────────────────────────────────────────────
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`PriceIQ API rodando em http://0.0.0.0:${config.PORT}`);
} catch (err) {
  app.log.error({ err }, 'falha ao iniciar');
  process.exit(1);
}

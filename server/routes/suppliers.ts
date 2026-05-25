import type { FastifyInstance } from 'fastify';
import { supplierService } from '../services/supplierService.js';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  idParamSchema,
  ownSearchTestSchema,
} from '../lib/validators.js';
import { autoConfigureSupplier } from '../suppliers/v2/autoConfig/index.js';
import {
  runOwnSearchPipeline,
  mapToDiagnosticResponse,
  resolveProvidersFromConfig,
  type RunOwnSearchPipelineInput,
  type OwnSearchPipelineOutcome,
} from '../suppliers/v2/searchEngine/index.js';

export interface SuppliersRoutesOptions {
  /** Injetável nos testes para evitar rede real. */
  runOwnSearchPipelineImpl?: (
    input: RunOwnSearchPipelineInput,
  ) => Promise<OwnSearchPipelineOutcome>;
}

export async function suppliersRoutes(
  fastify: FastifyInstance,
  opts: SuppliersRoutesOptions = {},
): Promise<void> {
  const runPipeline = opts.runOwnSearchPipelineImpl ?? runOwnSearchPipeline;
  // GET /api/suppliers
  fastify.get('/api/suppliers', async () => {
    const items = await supplierService.list();
    return { items };
  });

  // POST /api/suppliers
  fastify.post('/api/suppliers', async (req) => {
    const body = supplierCreateSchema.parse(req.body);
    const created = await supplierService.create(body);
    return created;
  });

  // PUT /api/suppliers/:id
  fastify.put('/api/suppliers/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = supplierUpdateSchema.parse(req.body);
    const updated = await supplierService.update(id, body);
    return updated;
  });

  // DELETE /api/suppliers/:id
  fastify.delete('/api/suppliers/:id', async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    await supplierService.delete(id);
    reply.code(204).send();
    return reply;
  });

  // POST /api/suppliers/:id/auto-configure — V2 Fase C
  //
  // Tenta configurar o fornecedor sozinho (detectar plataforma, URL de
  // busca, padrão de página de produto, estratégia de extração) e salvar
  // a receita correspondente. NÃO substitui o motor de busca atual.
  // NotFoundError (do supplierService.get) sobe para o errorHandler global
  // que devolve 404 automaticamente; outros erros viram 500 controlados.
  fastify.post('/api/suppliers/:id/auto-configure', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const result = await autoConfigureSupplier(id);
    return result;
  });

  // POST /api/suppliers/:id/test-own-search — diagnóstico do motor próprio (Etapas 8 + 11)
  //
  // Executa o pipeline próprio em isolamento para um fornecedor e query
  // arbitrários. Quando FIRECRAWL_ENABLED=true, usa o Firecrawl como coletor
  // principal e o NativeFetcher como fallback (resolveProvidersFromConfig).
  // NÃO salva resultados, NÃO usa IA/Gemini, NÃO altera cotação. A resposta
  // mostra o provider usado, se houve fallback e os attempts — nunca HTML bruto
  // nem a FIRECRAWL_API_KEY.
  async function runDiagnostic(id: string, query: string) {
    const supplier = await supplierService.get(id);
    const { providers, policy, budget } = resolveProvidersFromConfig();
    const outcome = await runPipeline({
      supplier,
      recipe: supplier.recipe ?? null,
      query,
      fetchProviders: providers,
      providerPolicy: policy,
      budget,
    });
    return mapToDiagnosticResponse({
      supplierId: id,
      supplierName: supplier.name,
      query,
      outcome,
    });
  }

  fastify.post('/api/suppliers/:id/test-own-search', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const { query } = ownSearchTestSchema.parse(req.body);
    return runDiagnostic(id, query);
  });

  // GET /api/suppliers/:id/test-own-search?query=... — variante GET (conveniência)
  fastify.get('/api/suppliers/:id/test-own-search', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const { query } = ownSearchTestSchema.parse(req.query);
    return runDiagnostic(id, query);
  });
}

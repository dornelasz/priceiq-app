import type { FastifyInstance } from 'fastify';
import { supplierService } from '../services/supplierService.js';
import { supplierCreateSchema, supplierUpdateSchema, idParamSchema } from '../lib/validators.js';

export async function suppliersRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/suppliers
  fastify.get('/api/suppliers', async () => {
    const items = await supplierService.list(null);
    return { items };
  });

  // POST /api/suppliers
  fastify.post('/api/suppliers', async (req) => {
    const body = supplierCreateSchema.parse(req.body);
    const created = await supplierService.create(body, null);
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
}

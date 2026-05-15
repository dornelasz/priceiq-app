/**
 * Reexport de client.ts — mantido para compatibilidade.
 * Novo código deve importar diretamente de './client.js'.
 */
export { pool, query, withTransaction, ping, closePool } from './client.js';

/**
 * Cache simples sobre Redis com fallback em memória.
 *
 * Falhas no Redis NÃO derrubam a aplicação — em ambiente sem Redis,
 * funciona como cache em memória de fallback.
 *
 * Helpers específicos:
 *  - getRatesCache / setRatesCache (chave única para cotação)
 *  - getSupplierResult / setSupplierResult (chave por supplier+query)
 */
import { Redis } from 'ioredis';
import { config } from '../config.js';

let redis: Redis | null = null;
let redisHealthy = false;
const memoryFallback = new Map<string, { value: string; expiresAt: number }>();

function connect(): void {
  if (redis) return;
  redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    enableOfflineQueue: false,
    reconnectOnError: () => true,
  });

  redis.on('ready', () => {
    redisHealthy = true;
    console.log('[cache] Redis conectado');
  });
  redis.on('error', (err) => {
    if (redisHealthy) {
      console.warn('[cache] Redis erro:', err.message);
    }
    redisHealthy = false;
  });
  redis.on('end', () => {
    redisHealthy = false;
  });

  redis.connect().catch((e) => {
    console.warn('[cache] Redis indisponível, usando memória:', e.message);
  });
}
connect();

const SUPPLIER_RESULT_TTL_SECONDS = 60 * 60; // 1 hora

export const cacheService = {
  async get(key: string): Promise<string | null> {
    if (redis && redisHealthy) {
      try {
        return await redis.get(key);
      } catch {
        // cai para memória
      }
    }
    const entry = memoryFallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memoryFallback.delete(key);
      return null;
    }
    return entry.value;
  },

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (redis && redisHealthy) {
      try {
        await redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        // cai para memória
      }
    }
    memoryFallback.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  },

  async del(key: string): Promise<void> {
    if (redis && redisHealthy) {
      try {
        await redis.del(key);
      } catch {
        // ignora
      }
    }
    memoryFallback.delete(key);
  },

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  },

  // ─── Helpers específicos ────────────────────────────────

  /**
   * Cache de resultado por (supplier_id, normalized_query).
   * TTL: 1h por padrão. Permite reuso entre buscas do mesmo produto.
   */
  async getSupplierResult<T>(supplierId: string, normalizedQuery: string): Promise<T | null> {
    return this.getJson<T>(`supplier_result:${supplierId}:${normalizedQuery}`);
  },

  async setSupplierResult<T>(supplierId: string, normalizedQuery: string, value: T): Promise<void> {
    await this.setJson(`supplier_result:${supplierId}:${normalizedQuery}`, value, SUPPLIER_RESULT_TTL_SECONDS);
  },

  isHealthy(): boolean {
    return redisHealthy;
  },

  async close(): Promise<void> {
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
      redis = null;
    }
    memoryFallback.clear();
  },
};

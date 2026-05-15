/**
 * Cotação Investing.com — porta do algoritmo do frontend (que está validado e estável).
 *
 * Diferenças vs. browser:
 *  - Server-side não tem CORS, então pode fazer fetch direto.
 *  - Mantém os mesmos proxies como fallback (caso Investing bloqueie o IP do servidor).
 *  - Cache Redis (TTL configurável) reduz hits ao Investing.
 *
 * IMPORTANTE: a lógica de Promise.any + parsing por data-test foi preservada
 * intacta — é o estado estável validado pelo usuário.
 */
import { config } from '../config.js';
import { query } from '../db/client.js';
import { cacheService } from './cacheService.js';

export type Pair = 'USD' | 'EUR' | 'CNY';

const RATE_RANGES: Record<Pair, [number, number]> = {
  USD: [3.0, 10.0],
  EUR: [4.0, 12.0],
  CNY: [0.3, 2.0],
};

interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
}

const CACHE_KEY = 'rates:current';

function parseInvestingNumber(raw: string): number {
  if (!raw) return NaN;
  const s = String(raw).trim();
  if (s.includes(',') && s.includes('.')) {
    const lc = s.lastIndexOf(',');
    const ld = s.lastIndexOf('.');
    if (lc > ld) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return parseFloat(s.replace(/,/g, ''));
  }
  if (s.includes(',')) return parseFloat(s.replace(',', '.'));
  return parseFloat(s);
}

function extractPriceFromHtml(html: string, range: [number, number]): number | null {
  if (!html || html.length < 200) return null;
  const patterns: RegExp[] = [
    /data-test=["']instrument-price-last["'][^>]*>\s*([\d.,]+)\s*</i,
    /<span[^>]+data-test="instrument-price-last"[^>]*>([\d.,]+)/i,
    /"last":\s*"?([\d.]+)"?\s*[,}]/,
    /"regularMarketPrice":\s*([\d.]+)/,
    /"last_close":\s*"?([\d.]+)"?/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (!m) continue;
    const num = parseInvestingNumber(m[1] ?? '');
    if (num >= range[0] && num <= range[1]) return num;
  }
  return null;
}

async function fetchOne(pair: Pair): Promise<number> {
  const slug = pair.toLowerCase() + '-brl';
  const range = RATE_RANGES[pair];
  const hosts = [
    `https://www.investing.com/currencies/${slug}`,
    `https://br.investing.com/currencies/${slug}`,
    `https://m.investing.com/currencies/${slug}`,
  ];
  const proxies: Array<(u: string) => string> = [
    (u) => u,                                                            // direto (sem CORS no server)
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  const attempts: Array<Promise<number>> = [];
  for (const host of hosts) {
    for (const mkProxy of proxies) {
      attempts.push(
        (async () => {
          const url = mkProxy(host + '?_t=' + Date.now());
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          try {
            const r = await fetch(url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)',
                Accept: 'text/html,application/xhtml+xml',
              },
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const html = await r.text();
            const num = extractPriceFromHtml(html, range);
            if (num === null) throw new Error('preço não encontrado');
            return num;
          } finally {
            clearTimeout(timer);
          }
        })(),
      );
    }
  }
  return Promise.any(attempts).catch(() => {
    throw new Error(`Investing.com falhou para ${pair}`);
  });
}

async function persistRate(pair: Pair, value: number): Promise<void> {
  try {
    await query(
      `INSERT INTO exchange_rates (currency, brl_rate, source) VALUES ($1, $2, $3)`,
      [pair, value, 'Investing.com'],
    );
  } catch (e) {
    console.warn('[currency] não foi possível persistir cotação:', (e as Error).message);
  }
}

export const currencyService = {
  /**
   * Retorna cotações (USD/EUR/CNY) — usa cache Redis se válido,
   * senão refresca da Investing.com. Aceita atualização PARCIAL
   * (se 1 ou 2 das 3 moedas falharem, retorna as válidas).
   */
  async getRates(force = false): Promise<RatesPayload> {
    if (!force) {
      const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
      if (cached) return { ...cached, from_cache: true };
    }

    const [usd, eur, cny] = await Promise.all([
      fetchOne('USD').catch((e) => {
        console.warn('[currency USD]', (e as Error).message);
        return null;
      }),
      fetchOne('EUR').catch((e) => {
        console.warn('[currency EUR]', (e as Error).message);
        return null;
      }),
      fetchOne('CNY').catch((e) => {
        console.warn('[currency CNY]', (e as Error).message);
        return null;
      }),
    ]);

    // Persiste no histórico para as que vieram
    if (usd !== null) void persistRate('USD', usd);
    if (eur !== null) void persistRate('EUR', eur);
    if (cny !== null) void persistRate('CNY', cny);

    // Se nada veio E não há cache, retorna nulls
    if (usd === null && eur === null && cny === null) {
      const fallback = await cacheService.getJson<RatesPayload>(CACHE_KEY);
      if (fallback) return { ...fallback, from_cache: true };
      return {
        usd: null,
        eur: null,
        cny: null,
        source: 'unavailable',
        fetched_at: new Date().toISOString(),
        from_cache: false,
      };
    }

    // Mescla com cache para preencher moedas faltantes
    const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
    const payload: RatesPayload = {
      usd: usd ?? cached?.usd ?? null,
      eur: eur ?? cached?.eur ?? null,
      cny: cny ?? cached?.cny ?? null,
      source: 'Investing.com',
      fetched_at: new Date().toISOString(),
      from_cache: false,
    };

    await cacheService.setJson(CACHE_KEY, payload, config.RATES_CACHE_TTL_SECONDS);
    return payload;
  },

  async getHistory(pair: Pair, limit = 50): Promise<Array<{ value: number; collected_at: string }>> {
    const r = await query<{ brl_rate: string; collected_at: Date }>(
      `SELECT brl_rate, collected_at FROM exchange_rates
       WHERE currency = $1
       ORDER BY collected_at DESC
       LIMIT $2`,
      [pair, limit],
    );
    return r.rows.map((row) => ({
      value: parseFloat(row.brl_rate),
      collected_at: row.collected_at.toISOString(),
    }));
  },
};

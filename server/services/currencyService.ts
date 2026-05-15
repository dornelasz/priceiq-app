/**
 * Currency service — cotação automática primeiro, cache/histórico apenas como fallback.
 *
 * Fonte principal: AwesomeAPI (/json/last/USD-BRL,EUR-BRL,CNY-BRL)
 * Fallback: Investing.com (extração antiga, por moeda)
 *
 * Regras:
 *  - Não usa Gemini/IA para cotação.
 *  - USD/EUR/CNY atualizam de forma independente.
 *  - Se uma moeda falhar, as outras continuam atualizando.
 *  - Valores antigos/cache/histórico entram apenas como fallback.
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

export interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
  partial?: boolean;
  warnings?: string[];
}

const CACHE_KEY = 'rates:current';
const PAIRS: Pair[] = ['USD', 'EUR', 'CNY'];

type RateKey = 'usd' | 'eur' | 'cny';

function keyOf(pair: Pair): RateKey {
  return pair.toLowerCase() as RateKey;
}

function parseRateNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let n: number;
  if (s.includes(',') && s.includes('.')) {
    const lc = s.lastIndexOf(',');
    const ld = s.lastIndexOf('.');
    n = lc > ld ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/,/g, ''));
  } else if (s.includes(',')) {
    n = parseFloat(s.replace(',', '.'));
  } else {
    n = parseFloat(s);
  }

  return Number.isFinite(n) ? n : null;
}

function isValidRate(pair: Pair, value: number | null | undefined): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const [min, max] = RATE_RANGES[pair];
  return value >= min && value <= max;
}

async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAwesomeRates(): Promise<Partial<Record<Pair, number>>> {
  const url = 'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL?_t=' + Date.now();
  const r = await fetchWithTimeout(url, 8000, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'PriceIQ/1.0' },
  });

  if (!r.ok) throw new Error(`AwesomeAPI HTTP ${r.status}`);

  const data = (await r.json()) as Record<string, { bid?: string; ask?: string }>;
  const apiKeys: Record<Pair, string> = { USD: 'USDBRL', EUR: 'EURBRL', CNY: 'CNYBRL' };
  const out: Partial<Record<Pair, number>> = {};

  for (const pair of PAIRS) {
    const node = data[apiKeys[pair]];
    const val = parseRateNumber(node?.bid ?? node?.ask);
    if (isValidRate(pair, val)) out[pair] = parseFloat(val.toFixed(4));
  }

  if (!Object.keys(out).length) throw new Error('AwesomeAPI sem cotações válidas');
  return out;
}

function extractInvestingPrice(html: string, pair: Pair): number | null {
  if (!html || html.length < 200) return null;

  const patterns: RegExp[] = [
    /data-test=["']instrument-price-last["'][^>]*>\s*([\d.,]+)\s*</i,
    /<span[^>]+data-test="instrument-price-last"[^>]*>([\d.,]+)/i,
    /"last":\s*"?([\d.,]+)"?\s*[,}]/,
    /"regularMarketPrice":\s*([\d.,]+)/,
    /"last_close":\s*"?([\d.,]+)"?/,
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (!m) continue;
    const num = parseRateNumber(m[1]);
    if (isValidRate(pair, num)) return parseFloat(num.toFixed(4));
  }

  return null;
}

async function fetchInvestingRate(pair: Pair): Promise<number> {
  const slug = pair.toLowerCase() + '-brl';
  const hosts = [
    `https://www.investing.com/currencies/${slug}`,
    `https://br.investing.com/currencies/${slug}`,
    `https://m.investing.com/currencies/${slug}`,
  ];
  const proxies: Array<(u: string) => string> = [
    (u) => u,
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
          const r = await fetchWithTimeout(url, 6000, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)',
              Accept: 'text/html,application/xhtml+xml',
            },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const html = await r.text();
          const num = extractInvestingPrice(html, pair);
          if (num === null) throw new Error('preço não encontrado');
          return num;
        })(),
      );
    }
  }

  return Promise.any(attempts).catch(() => {
    throw new Error(`Investing.com falhou para ${pair}`);
  });
}

async function persistRate(pair: Pair, value: number, source: string): Promise<void> {
  try {
    await query(`INSERT INTO exchange_rates (currency, brl_rate, source) VALUES ($1, $2, $3)`, [pair, value, source]);
  } catch (e) {
    console.warn('[currency] não foi possível persistir cotação:', (e as Error).message);
  }
}

async function latestHistory(): Promise<Partial<Record<Pair, number>>> {
  try {
    const r = await query<{ currency: Pair; brl_rate: string }>(
      `SELECT DISTINCT ON (currency) currency, brl_rate
       FROM exchange_rates
       WHERE currency = ANY($1::text[])
       ORDER BY currency, collected_at DESC`,
      [PAIRS],
    );

    const out: Partial<Record<Pair, number>> = {};
    for (const row of r.rows) {
      const val = parseRateNumber(row.brl_rate);
      if (isValidRate(row.currency, val)) out[row.currency] = val;
    }
    return out;
  } catch (e) {
    console.warn('[currency] não foi possível ler histórico:', (e as Error).message);
    return {};
  }
}

function toPayload(values: Partial<Record<Pair, number>>, source: string, fromCache: boolean, warnings: string[] = []): RatesPayload {
  return {
    usd: values.USD ?? null,
    eur: values.EUR ?? null,
    cny: values.CNY ?? null,
    source,
    fetched_at: new Date().toISOString(),
    from_cache: fromCache,
    partial: !(values.USD && values.EUR && values.CNY),
    warnings,
  };
}

export const currencyService = {
  /**
   * Retorna cotações USD/EUR/CNY.
   * force=true ignora cache e tenta sempre atualização automática primeiro.
   */
  async getRates(force = false): Promise<RatesPayload> {
    if (!force) {
      const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
      if (cached) return { ...cached, from_cache: true };
    }

    const warnings: string[] = [];
    const values: Partial<Record<Pair, number>> = {};
    const sources = new Set<string>();

    // 1. Fonte principal: AwesomeAPI. Corrige USD/BRL via USDBRL.bid.
    try {
      const awesome = await fetchAwesomeRates();
      for (const pair of PAIRS) {
        const v = awesome[pair];
        if (isValidRate(pair, v)) values[pair] = v;
      }
      if (Object.keys(awesome).length) sources.add('AwesomeAPI');
    } catch (e) {
      warnings.push(`AwesomeAPI: ${(e as Error).message}`);
    }

    // 2. Fallback parcial por moeda: Investing só para o que faltou.
    await Promise.all(
      PAIRS.map(async (pair) => {
        if (isValidRate(pair, values[pair])) return;
        try {
          const v = await fetchInvestingRate(pair);
          if (isValidRate(pair, v)) {
            values[pair] = v;
            sources.add('Investing.com');
          }
        } catch (e) {
          warnings.push(`${pair}: ${(e as Error).message}`);
        }
      }),
    );

    // 3. Persiste apenas moedas atualizadas automaticamente.
    for (const pair of PAIRS) {
      const v = values[pair];
      if (isValidRate(pair, v)) void persistRate(pair, v, Array.from(sources).join(' + ') || 'automatic');
    }

    const anyAutomatic = PAIRS.some((pair) => isValidRate(pair, values[pair]));

    // 4. Completa moedas faltantes com cache/histórico apenas como fallback.
    const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
    const history = await latestHistory();
    for (const pair of PAIRS) {
      if (isValidRate(pair, values[pair])) continue;
      const cachedValue = cached?.[keyOf(pair)];
      if (isValidRate(pair, cachedValue)) values[pair] = cachedValue;
      else if (isValidRate(pair, history[pair])) values[pair] = history[pair];
    }

    if (!anyAutomatic) {
      return toPayload(values, cached ? `${cached.source || 'cache'} fallback` : 'manual/history fallback', true, warnings);
    }

    const source = Array.from(sources).join(' + ') || 'automatic';
    const payload = toPayload(values, source, false, warnings);
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

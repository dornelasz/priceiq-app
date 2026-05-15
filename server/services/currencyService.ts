import { config } from '../config.js';
import { query } from '../db/client.js';
import { cacheService } from './cacheService.js';

export type Pair = 'USD' | 'EUR' | 'CNY';

const RATE_RANGES: Record<Pair, [number, number]> = {
  USD: [3.0, 10.0],
  EUR: [4.0, 12.0],
  CNY: [0.3, 2.0],
};

const SOURCE = 'Investing.com';

interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
  partial?: boolean;
  warnings: Record<Pair, string | null>;
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
    /pid-\d+-last[^>]*>\s*([\d.,]+)\s*</i,
    /id=["']last_last["'][^>]*>\s*([\d.,]+)\s*</i,
    /class=["'][^"']*text-2xl[^"']*["'][^>]*>\s*([\d.,]+)\s*</i,
    /"lastPrice":\s*"?([\d.]+)"?/,
    /"price":\s*"?([\d.]+)"?\s*[,}]/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (!m) continue;
    const num = parseInvestingNumber(m[1] ?? '');
    if (num >= range[0] && num <= range[1]) return num;
  }
  return null;
}

function cleanVisibleText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractPriceFromVisibleText(
  html: string,
  range: [number, number],
  pair: Pair,
): number | null {
  if (!html) return null;
  const text = cleanVisibleText(html);
  if (text.length < 30) return null;

  const slash = `${pair}\\/BRL`;
  const patterns: RegExp[] = [
    new RegExp(`current\\s+${slash}\\s+exchange\\s+rate\\s+is\\s+([\\d.,]+)`, 'i'),
    new RegExp(`bid\\s+price\\s+is\\s+([\\d.,]+)\\s+and\\s+the\\s+ask\\s+price\\s+is\\s+[\\d.,]+\\s+for\\s+${slash}`, 'i'),
    new RegExp(`${slash}[\\s\\S]{0,260}?Real-time\\s+Currencies[\\s\\S]{0,180}?(\\d+[.,]\\d{3,6})`, 'i'),
    new RegExp(`Real-time\\s+Currencies[\\s\\S]{0,260}?${slash}[\\s\\S]{0,120}?(\\d+[.,]\\d{3,6})`, 'i'),
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (!m || !m[1]) continue;
    const num = parseInvestingNumber(m[1]);
    if (num >= range[0] && num <= range[1]) return num;
  }
  return null;
}

async function fetchOneInvesting(pair: Pair): Promise<number> {
  const slug = pair.toLowerCase() + '-brl';
  const range = RATE_RANGES[pair];
  const hosts = [
    `https://www.investing.com/currencies/${slug}`,
    `https://br.investing.com/currencies/${slug}`,
    `https://m.investing.com/currencies/${slug}`,
    `https://www.investing.com/currencies/${slug}-historical-data`,
    `https://www.investing.com/currencies/${slug}-technical`,
    `https://www.investing.com/currencies/${slug}-streaming-chart`,
  ];
  const proxies: Array<(u: string) => string> = [
    (u) => u,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  ];

  const attempts: Array<Promise<number>> = [];
  const failures: string[] = [];
  for (const host of hosts) {
    for (const mkProxy of proxies) {
      attempts.push((async () => {
        const buster = `_t=${Date.now()}_r=${Math.random().toString(36).slice(2, 8)}`;
        const url = mkProxy(host + '?' + buster);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
          const r = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)', Accept: 'text/html,application/xhtml+xml' },
          });
          if (!r.ok) {
            failures.push(`${pair} ${host.split('/').pop()} → HTTP ${r.status}`);
            throw new Error(`HTTP ${r.status}`);
          }
          const html = await r.text();
          const fromDom = extractPriceFromHtml(html, range);
          if (fromDom !== null) return fromDom;
          const fromText = extractPriceFromVisibleText(html, range, pair);
          if (fromText !== null) return fromText;
          failures.push(`${pair} ${host.split('/').pop()} → HTML sem preço (${html.length}b)`);
          throw new Error('preço não encontrado');
        } finally { clearTimeout(timer); }
      })());
    }
  }
  return Promise.any(attempts).catch(() => {
    console.warn(`[Investing ${pair}] todas as ${attempts.length} tentativas falharam:`);
    failures.slice(0, 15).forEach((f) => console.warn('  · ' + f));
    throw new Error(`Investing.com falhou para ${pair} (${attempts.length} tentativas)`);
  });
}

async function persistRate(pair: Pair, value: number): Promise<void> {
  try {
    await query(`INSERT INTO exchange_rates (currency, brl_rate, source) VALUES ($1, $2, $3)`, [pair, value, SOURCE]);
  } catch (e) {
    console.warn('[currency] não foi possível persistir cotação:', (e as Error).message);
  }
}

async function getLastAutoRate(pair: Pair): Promise<{ value: number; collected_at: string } | null> {
  try {
    const r = await query<{ brl_rate: string; collected_at: Date }>(
      `SELECT brl_rate, collected_at FROM exchange_rates
       WHERE currency = $1 AND source = $2
       ORDER BY collected_at DESC LIMIT 1`,
      [pair, SOURCE],
    );
    const row = r.rows[0];
    if (!row) return null;
    const v = parseFloat(row.brl_rate);
    if (!Number.isFinite(v)) return null;
    const range = RATE_RANGES[pair];
    if (v < range[0] || v > range[1]) return null;
    return { value: v, collected_at: row.collected_at.toISOString() };
  } catch {
    return null;
  }
}

export const currencyService = {
  async getRates(force = false): Promise<RatesPayload> {
    if (!force) {
      const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
      if (cached) return { ...cached, from_cache: true };
    }

    const now = new Date().toISOString();
    const pairs: Pair[] = ['USD', 'EUR', 'CNY'];
    const results = await Promise.all(pairs.map(async (pair) => {
      try {
        const value = await fetchOneInvesting(pair);
        void persistRate(pair, value);
        return { pair, value, warning: null as string | null };
      } catch (e) {
        const last = await getLastAutoRate(pair);
        if (last) {
          return {
            pair,
            value: last.value,
            warning: `Investing.com indisponível para ${pair}/BRL — exibindo último valor automático (${new Date(last.collected_at).toLocaleTimeString('pt-BR')})`,
          };
        }
        return { pair, value: null as number | null, warning: `Investing.com indisponível para ${pair}/BRL (${(e as Error).message})` };
      }
    }));

    const byPair = Object.fromEntries(results.map((r) => [r.pair, r])) as Record<Pair, typeof results[number]>;
    const warnings: Record<Pair, string | null> = {
      USD: byPair.USD.warning,
      EUR: byPair.EUR.warning,
      CNY: byPair.CNY.warning,
    };
    const partial = pairs.some((p) => byPair[p].warning !== null);

    const payload: RatesPayload = {
      usd: byPair.USD.value,
      eur: byPair.EUR.value,
      cny: byPair.CNY.value,
      source: SOURCE,
      fetched_at: now,
      from_cache: false,
      partial,
      warnings,
    };

    await cacheService.setJson(CACHE_KEY, payload, config.RATES_CACHE_TTL_SECONDS);
    return payload;
  },
};

import { config } from '../config.js';
import { query } from '../db/client.js';
import { cacheService } from './cacheService.js';

export type Pair = 'USD' | 'EUR' | 'CNY';

const RATE_RANGES: Record<Pair, [number, number]> = {
  USD: [3.0, 10.0],
  EUR: [4.0, 12.0],
  CNY: [0.3, 2.0],
};

interface CurrencyRateDetail {
  currency: Pair;
  brl_rate: number | null;
  source: string;
  collected_at: string;
  is_manual: boolean;
  manual_rate: number | null;
  warning: string | null;
}

interface RatesPayload {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  source: string;
  fetched_at: string;
  from_cache: boolean;
  partial?: boolean;
  details: Record<Pair, CurrencyRateDetail>;
}

interface ManualRatesSettings {
  manual_mode?: boolean;
  rates?: Partial<Record<Pair, number>>;
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

async function fetchAwesomeRates(): Promise<Partial<Record<Pair, number>>> {
  const url = 'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,CNY-BRL';
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`AwesomeAPI HTTP ${r.status}`);
  const json = await r.json() as Record<string, { bid?: string }>;
  const parsePair = (k: string, range: [number, number]): number | null => {
    const value = parseFloat(json[k]?.bid ?? '');
    if (!Number.isFinite(value)) return null;
    if (value < range[0] || value > range[1]) return null;
    return value;
  };
  return {
    USD: parsePair('USDBRL', RATE_RANGES.USD) ?? undefined,
    EUR: parsePair('EURBRL', RATE_RANGES.EUR) ?? undefined,
    CNY: parsePair('CNYBRL', RATE_RANGES.CNY) ?? undefined,
  };
}

async function fetchOneInvesting(pair: Pair): Promise<number> {
  const slug = pair.toLowerCase() + '-brl';
  const range = RATE_RANGES[pair];
  const hosts = [`https://www.investing.com/currencies/${slug}`, `https://br.investing.com/currencies/${slug}`, `https://m.investing.com/currencies/${slug}`];
  const proxies: Array<(u: string) => string> = [
    (u) => u,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  const attempts: Array<Promise<number>> = [];
  for (const host of hosts) {
    for (const mkProxy of proxies) {
      attempts.push((async () => {
        const url = mkProxy(host + '?_t=' + Date.now());
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const r = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceIQ/1.0)', Accept: 'text/html,application/xhtml+xml' },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const html = await r.text();
          const num = extractPriceFromHtml(html, range);
          if (num === null) throw new Error('preço não encontrado');
          return num;
        } finally { clearTimeout(timer); }
      })());
    }
  }
  return Promise.any(attempts).catch(() => { throw new Error(`Investing.com falhou para ${pair}`); });
}

async function fetchAutoForPair(pair: Pair, awesomeRates: Partial<Record<Pair, number>>): Promise<{ value: number | null; source: string | null; warning: string | null }> {
  const awesome = awesomeRates[pair];
  if (typeof awesome === 'number') return { value: awesome, source: 'AwesomeAPI', warning: null };
  try {
    const investing = await fetchOneInvesting(pair);
    return { value: investing, source: 'Investing.com', warning: 'AwesomeAPI indisponível; fallback automático via Investing.com' };
  } catch (e) {
    return { value: null, source: null, warning: `Falha na atualização automática (${(e as Error).message})` };
  }
}

async function persistRate(pair: Pair, value: number, source: string): Promise<void> {
  try {
    await query(`INSERT INTO exchange_rates (currency, brl_rate, source) VALUES ($1, $2, $3)`, [pair, value, source]);
  } catch (e) {
    console.warn('[currency] não foi possível persistir cotação:', (e as Error).message);
  }
}

async function getManualSettings(): Promise<ManualRatesSettings> {
  try {
    const r = await query<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', ['rates_manual']);
    return (r.rows[0]?.value as ManualRatesSettings | undefined) ?? {};
  } catch {
    return {};
  }
}

export const currencyService = {
  async getRates(force = false): Promise<RatesPayload> {
    if (!force) {
      const cached = await cacheService.getJson<RatesPayload>(CACHE_KEY);
      if (cached) return { ...cached, from_cache: true };
    }

    const manual = await getManualSettings();
    const awesomeRates = await fetchAwesomeRates().catch(() => ({}));
    const now = new Date().toISOString();

    const entries = await Promise.all((['USD', 'EUR', 'CNY'] as Pair[]).map(async (pair) => {
      const auto = await fetchAutoForPair(pair, awesomeRates);
      const manualRate = manual.rates?.[pair] ?? null;
      if (auto.value !== null) {
        void persistRate(pair, auto.value, auto.source ?? 'auto');
        return [pair, {
          currency: pair,
          brl_rate: auto.value,
          source: auto.source ?? 'auto',
          collected_at: now,
          is_manual: false,
          manual_rate: manualRate,
          warning: auto.warning,
        } satisfies CurrencyRateDetail] as const;
      }
      if (typeof manualRate === 'number') {
        return [pair, {
          currency: pair,
          brl_rate: manualRate,
          source: 'manual-fallback',
          collected_at: now,
          is_manual: true,
          manual_rate: manualRate,
          warning: auto.warning,
        } satisfies CurrencyRateDetail] as const;
      }
      return [pair, {
        currency: pair,
        brl_rate: null,
        source: 'unavailable',
        collected_at: now,
        is_manual: false,
        manual_rate: manualRate,
        warning: auto.warning,
      } satisfies CurrencyRateDetail] as const;
    }));

    const details = Object.fromEntries(entries) as Record<Pair, CurrencyRateDetail>;

    if (manual.manual_mode) {
      for (const pair of ['USD', 'EUR', 'CNY'] as Pair[]) {
        const value = manual.rates?.[pair];
        if (typeof value === 'number') {
          details[pair] = {
            ...details[pair],
            brl_rate: value,
            source: 'manual-mode',
            is_manual: true,
            warning: details[pair].warning ?? 'Modo manual ativo para esta moeda',
          };
        }
      }
    }

    const payload: RatesPayload = {
      usd: details.USD.brl_rate,
      eur: details.EUR.brl_rate,
      cny: details.CNY.brl_rate,
      source: 'multi-source',
      fetched_at: now,
      from_cache: false,
      partial: [details.USD, details.EUR, details.CNY].some((x) => !!x.warning),
      details,
    };

    await cacheService.setJson(CACHE_KEY, payload, config.RATES_CACHE_TTL_SECONDS);
    return payload;
  },
};

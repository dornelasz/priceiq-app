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
    // Padrões adicionais usados em /historical-data, /technical, /streaming-chart
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

/**
 * Limpa HTML para texto visível: tira scripts, styles, tags e normaliza espaços.
 * Usado pelo fallback de texto da Investing — quando o DOM não renderiza
 * (proxies retornam HTML estático), a página ainda contém frases descritivas
 * como "The current USD/BRL exchange rate is X.XXXX" que conseguem ser extraídas.
 */
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

/**
 * Fallback de texto visível para Investing.com — pega frases descritivas que
 * aparecem mesmo quando o DOM não foi renderizado pelos proxies.
 *
 * Padrões cobertos:
 *  1. "The current USD/BRL exchange rate is 5.0696"
 *  2. "bid price is 5.0686 and the ask price is 5.0707 for USD/BRL"
 *  3. Bloco "USD/BRL ... Real-time Currencies ... <preço>"
 *
 * Aplica sanity range — números fora da faixa esperada são rejeitados.
 */
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
    // "The current USD/BRL exchange rate is 5.0696"
    new RegExp(`current\\s+${slash}\\s+exchange\\s+rate\\s+is\\s+([\\d.,]+)`, 'i'),
    // "bid price is X.XXXX and the ask price is Y.YYYY for USD/BRL"
    new RegExp(`bid\\s+price\\s+is\\s+([\\d.,]+)\\s+and\\s+the\\s+ask\\s+price\\s+is\\s+[\\d.,]+\\s+for\\s+${slash}`, 'i'),
    // "USD/BRL ... Real-time Currencies ... <número>"
    new RegExp(`${slash}[\\s\\S]{0,260}?Real-time\\s+Currencies[\\s\\S]{0,180}?(\\d+[.,]\\d{3,6})`, 'i'),
    // "Real-time Currencies ... USD/BRL ... <número>"
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
  // 6 hosts — Investing tem várias páginas para o mesmo par. USD/BRL é
  // o par mais acessado; cache dos proxies satura nele. Mais variações
  // = mais chance de cache miss em alguma combinação.
  const hosts = [
    `https://www.investing.com/currencies/${slug}`,
    `https://br.investing.com/currencies/${slug}`,
    `https://m.investing.com/currencies/${slug}`,
    `https://www.investing.com/currencies/${slug}-historical-data`,
    `https://www.investing.com/currencies/${slug}-technical`,
    `https://www.investing.com/currencies/${slug}-streaming-chart`,
  ];
  // 5 proxies — server-side podemos usar direto (sem proxy) também
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
          // 1) Parser DOM/JSON (rápido e preciso)
          const fromDom = extractPriceFromHtml(html, range);
          if (fromDom !== null) return fromDom;
          // 2) Fallback texto visível (crítico p/ USD/BRL)
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

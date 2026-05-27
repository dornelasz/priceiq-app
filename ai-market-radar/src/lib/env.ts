// Centralized env access. Reads are lazy and never throw on import so that
// pure modules / tests don't require a fully configured environment.

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const env = {
  get geminiApiKey(): string {
    return str("GEMINI_API_KEY").trim();
  },
  get geminiModel(): string {
    return str("GEMINI_MODEL", "gemini-2.0-flash").trim();
  },
  get isAiConfigured(): boolean {
    return this.geminiApiKey.length > 0;
  },
  get workerFetchCron(): string {
    return str("WORKER_FETCH_CRON", "*/15 * * * *");
  },
  get workerDigestCron(): string {
    return str("WORKER_DIGEST_CRON", "0 6 * * *");
  },
  get timezone(): string {
    return str("TZ", "America/Sao_Paulo");
  },
  get defaultFetchIntervalMinutes(): number {
    // Canonical name is FETCH_INTERVAL_MINUTES; keep the older name as fallback.
    const raw = process.env.FETCH_INTERVAL_MINUTES ?? process.env.DEFAULT_FETCH_INTERVAL_MINUTES;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : 60;
  },
  get appUrl(): string {
    return str("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  },
  get analyzeOnFetch(): boolean {
    return bool("ANALYZE_ON_FETCH", true);
  },
  get maxAnalyzePerRun(): number {
    return int("MAX_ANALYZE_PER_RUN", 20);
  },
  get httpUserAgent(): string {
    return str("HTTP_USER_AGENT", "AIMarketRadar/1.0");
  },
  get fetchTimeoutMs(): number {
    return int("FETCH_TIMEOUT_MS", 15000);
  },
  get runFetchOnSeed(): boolean {
    return bool("RUN_FETCH_ON_SEED", false);
  },
  get appName(): string {
    return str("NEXT_PUBLIC_APP_NAME", "AI Market Radar");
  },
};

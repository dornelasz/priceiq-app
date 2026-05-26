// Load a local .env into process.env for standalone Node processes
// (worker, seed, CLI). Next.js loads .env automatically for the app, but
// tsx-launched scripts do not. Uses Node 22's built-in loader — no dependency.
// Silently ignored when the file is absent (e.g. env injected by the platform).
export function loadEnv(): void {
  try {
    (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
  } catch {
    /* no .env file — rely on environment-provided variables */
  }
}

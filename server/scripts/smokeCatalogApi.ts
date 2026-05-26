/**
 * smokeCatalogApi — CLI smoke tester para o backend PriceIQ.
 *
 * Uso:
 *   PRICEIQ_API_URL=https://... tsx scripts/smokeCatalogApi.ts [flags]
 *   npm run smoke:api -- [flags]
 *
 * Flags:
 *   --safe                 Apenas GET /api/health + GET /api/suppliers (padrão)
 *   --catalog              Inclui rotas de leitura do catálogo (GET, sem scraping)
 *   --supplier-id=<uuid>   ID do fornecedor (obrigatório com --catalog)
 *   --query=<texto>        Query de busca (obrigatório com --catalog)
 *   --max-candidates=<n>   Limita listagem de candidatos (padrão: sem limite)
 *
 * Requer Node 18+ (fetch nativo).
 * Não chama Firecrawl, não escreve no banco, não faz scraping.
 */

const API_URL = process.env['PRICEIQ_API_URL']?.replace(/\/$/, '');
if (!API_URL) {
  console.error('[smoke] PRICEIQ_API_URL não definido. Exemplo:');
  console.error('  PRICEIQ_API_URL=https://meuserver.fly.dev npm run smoke:api');
  process.exit(1);
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.some((a) => a === `--${name}`);
const flagValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const isSafe = hasFlag('safe') || !hasFlag('catalog');
const isCatalog = hasFlag('catalog');
const supplierId = flagValue('supplier-id');
const query = flagValue('query');
const maxCandidates = flagValue('max-candidates') ? Number(flagValue('max-candidates')) : null;

if (isCatalog && (!supplierId || !query)) {
  console.error('[smoke] --catalog requer --supplier-id=<uuid> e --query=<texto>');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TestResult = { label: string; passed: boolean; status?: number; detail?: string };

async function probe(label: string, path: string): Promise<TestResult> {
  const url = `${API_URL}${path}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    const passed = res.ok;
    const detail = passed ? undefined : JSON.stringify(body)?.slice(0, 200);
    return { label, passed, status: res.status, detail };
  } catch (err) {
    return { label, passed: false, detail: String(err) };
  }
}

function encodedQuery(q: string): string {
  return encodeURIComponent(q);
}

// ─── Test suites ─────────────────────────────────────────────────────────────

async function runSafeTests(): Promise<TestResult[]> {
  return Promise.all([
    probe('GET /api/health', '/api/health'),
    probe('GET /api/suppliers', '/api/suppliers'),
  ]);
}

async function runCatalogTests(sid: string, q: string): Promise<TestResult[]> {
  const base = `/api/suppliers/${sid}/catalog`;
  const qs = `?query=${encodedQuery(q)}`;
  return Promise.all([
    probe(`GET ${base}/candidates`, `${base}/candidates${qs}`),
    probe(`GET ${base}/matches`, `${base}/matches${qs}`),
    probe(`GET ${base}/discovery-runs`, `${base}/discovery-runs${qs}`),
  ]);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[smoke] API: ${API_URL}`);
  console.log(`[smoke] mode: ${isCatalog ? 'safe + catalog' : 'safe only'}`);
  if (isCatalog) {
    console.log(`[smoke] supplier-id: ${supplierId}`);
    console.log(`[smoke] query: "${query}"`);
  }
  console.log('');

  const results: TestResult[] = [];

  results.push(...await runSafeTests());

  if (isCatalog && supplierId && query) {
    results.push(...await runCatalogTests(supplierId, query));
  }

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    const status = r.status != null ? ` [${r.status}]` : '';
    console.log(`  ${icon} ${r.label}${status}${r.detail ? `  → ${r.detail}` : ''}`);
    if (r.passed) passed++;
    else failed++;
  }

  console.log('');
  console.log(`[smoke] ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] erro inesperado:', err);
  process.exit(1);
});

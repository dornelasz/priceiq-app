/**
 * Etapa 5 — fundação do motor próprio de busca.
 *
 * Cobre os contratos e helpers SEM tocar rede, DB ou IA:
 *  - contexto criado com defaults seguros + query normalizada
 *  - providerPolicy desliga Firecrawl/IA por padrão
 *  - budget zera external fetch e IA por padrão (e consumeBudget respeita limite)
 *  - NativeFetcher é o provider principal (type=native, prioridade no select)
 *  - FirecrawlProviderStub e AIProviderStub retornam 'disabled'
 *  - shouldTryExternalFetcher / shouldTryAI = false por padrão
 *  - 'partial' continua mapeado como status útil (V2 'validated')
 *  - falha controlada não vira 'error' genérico
 */
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  createSearchEngineContext,
  normalizeSearchQuery,
  addDiagnosticAttempt,
  DEFAULT_SEARCH_BUDGET,
  hasBudgetRemaining,
  consumeBudget,
  DEFAULT_PROVIDER_POLICY,
  resolveProviderPolicy,
  shouldTryExternalFetcher,
  shouldTryAI,
  selectFetchProvider,
  ownEngineFailed,
  createNativeFetchProvider,
  createFirecrawlProviderStub,
  createAIProviderStub,
  FIRECRAWL_DISABLED_REASON,
  AI_DISABLED_REASON,
  mapInternalStatusToPublicStatus,
  isUsefulInternalStatus,
  isControlledFailureStatus,
  makeSearchAttempt,
  SEARCH_ENGINE_INTERNAL_STATUSES,
} = await import('../suppliers/v2/searchEngine/index.js');

type Supplier = import('../services/supplierService.js').Supplier;
type Fetcher = import('../suppliers/v2/index.js').Fetcher;
type FetcherResult = import('../suppliers/v2/index.js').FetcherResult;
type SearchEngineContext =
  import('../suppliers/v2/searchEngine/index.js').SearchEngineContext;

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Loja Teste',
    site: 'https://loja.test',
    currency: 'BRL',
    country: 'BR',
    active: true,
    ...over,
  } as Supplier;
}

function makeContext(
  over: Partial<Parameters<typeof createSearchEngineContext>[0]> = {},
): SearchEngineContext {
  return createSearchEngineContext({
    supplier: makeSupplier(),
    query: 'Notebook Dell Inspiron 15',
    ...over,
  });
}

// ─── Contexto ──────────────────────────────────────────────────────────────

describe('createSearchEngineContext', () => {
  it('cria contexto com todos os campos e defaults seguros', () => {
    const ctx = makeContext({ searchId: 'abc', startedAt: 1000 });
    assert.equal(ctx.searchId, 'abc');
    assert.equal(ctx.supplier.id, 's1');
    assert.equal(ctx.recipe, null);
    assert.equal(ctx.query, 'Notebook Dell Inspiron 15');
    assert.equal(ctx.startedAt, 1000);
    assert.deepEqual(ctx.budget, DEFAULT_SEARCH_BUDGET);
    assert.deepEqual(ctx.providerPolicy, DEFAULT_PROVIDER_POLICY);
    assert.deepEqual(ctx.diagnostics.attempts, []);
    // uso zerado
    assert.equal(ctx.budgetUsage.externalFetches, 0);
    assert.equal(ctx.budgetUsage.aiCalls, 0);
  });

  it('normaliza a query (minúsculas, sem acento, sem pontuação)', () => {
    assert.equal(
      normalizeSearchQuery('Notebook DELL Inspiron-15!!'),
      'notebook dell inspiron 15',
    );
    assert.equal(normalizeSearchQuery('Café Latão à Vácuo'), 'cafe latao a vacuo');
    assert.equal(makeContext().normalizedQuery, 'notebook dell inspiron 15');
  });

  it('addDiagnosticAttempt registra no diagnostics em memória', () => {
    const ctx = makeContext();
    addDiagnosticAttempt(
      ctx,
      makeSearchAttempt({ step: 'native_fetch', status: 'native_fetch_success' }),
    );
    assert.equal(ctx.diagnostics.attempts.length, 1);
    assert.equal(ctx.diagnostics.attempts[0]?.status, 'native_fetch_success');
    assert.ok(ctx.diagnostics.attempts[0]?.at);
  });
});

// ─── ProviderPolicy ──────────────────────────────────────────────────────────

describe('ProviderPolicy', () => {
  it('desliga Firecrawl e IA por padrão; motor próprio ligado', () => {
    assert.equal(DEFAULT_PROVIDER_POLICY.firecrawlEnabled, false);
    assert.equal(DEFAULT_PROVIDER_POLICY.aiEnabled, false);
    assert.equal(DEFAULT_PROVIDER_POLICY.nativeFetcherEnabled, true);
    assert.equal(DEFAULT_PROVIDER_POLICY.preferOwnEngine, true);
    assert.equal(DEFAULT_PROVIDER_POLICY.requireEvidence, true);
    assert.equal(DEFAULT_PROVIDER_POLICY.allowExternalOnlyAfterOwnFailure, true);
  });

  it('resolveProviderPolicy preserva defaults seguros em override parcial', () => {
    const p = resolveProviderPolicy({ preferOwnEngine: false });
    assert.equal(p.preferOwnEngine, false);
    // Firecrawl/IA continuam desligados mesmo sem citar
    assert.equal(p.firecrawlEnabled, false);
    assert.equal(p.aiEnabled, false);
  });
});

// ─── SearchBudget ──────────────────────────────────────────────────────────

describe('SearchBudget', () => {
  it('zera external fetch e IA por padrão', () => {
    assert.equal(DEFAULT_SEARCH_BUDGET.maxExternalFetches, 0);
    assert.equal(DEFAULT_SEARCH_BUDGET.maxAiCalls, 0);
    assert.ok(DEFAULT_SEARCH_BUDGET.maxNativeFetches > 0);
  });

  it('bloqueia external fetch e IA por padrão (sem orçamento)', () => {
    const ctx = makeContext();
    assert.equal(hasBudgetRemaining(ctx, 'externalFetch'), false);
    assert.equal(hasBudgetRemaining(ctx, 'aiCall'), false);
    assert.equal(consumeBudget(ctx, 'externalFetch'), false);
    assert.equal(consumeBudget(ctx, 'aiCall'), false);
    // contador não incrementa quando bloqueado
    assert.equal(ctx.budgetUsage.externalFetches, 0);
  });

  it('permite native fetch e consome até o limite', () => {
    const ctx = makeContext({ budget: { maxNativeFetches: 2 } });
    assert.equal(consumeBudget(ctx, 'nativeFetch'), true);
    assert.equal(consumeBudget(ctx, 'nativeFetch'), true);
    assert.equal(consumeBudget(ctx, 'nativeFetch'), false); // esgotou
    assert.equal(ctx.budgetUsage.nativeFetches, 2);
  });

  it('orçamento de tempo (elapsed) respeita maxElapsedMs', () => {
    const ctx = makeContext({
      startedAt: Date.now() - 1000,
      budget: { maxElapsedMs: 500 },
    });
    assert.equal(hasBudgetRemaining(ctx, 'elapsed'), false);
    const fresh = makeContext({ budget: { maxElapsedMs: 60000 } });
    assert.equal(hasBudgetRemaining(fresh, 'elapsed'), true);
  });
});

// ─── Decisões de pipeline ────────────────────────────────────────────────────

describe('pipeline decisions', () => {
  it('shouldTryExternalFetcher=false por padrão', () => {
    assert.equal(shouldTryExternalFetcher(makeContext()), false);
  });

  it('shouldTryAI=false por padrão', () => {
    assert.equal(shouldTryAI(makeContext()), false);
  });

  it('shouldTryExternalFetcher continua false se ligar policy mas orçamento=0', () => {
    const ctx = makeContext({ providerPolicy: { firecrawlEnabled: true } });
    // maxExternalFetches ainda é 0 → sem orçamento
    assert.equal(shouldTryExternalFetcher(ctx), false);
  });

  it('shouldTryExternalFetcher exige falha do motor próprio antes do externo', () => {
    const ctx = makeContext({
      providerPolicy: { firecrawlEnabled: true },
      budget: { maxExternalFetches: 1 },
    });
    // motor próprio ainda não falhou → false
    assert.equal(ownEngineFailed(ctx), false);
    assert.equal(shouldTryExternalFetcher(ctx), false);
    // registra falha do nativo
    addDiagnosticAttempt(
      ctx,
      makeSearchAttempt({
        step: 'native_fetch',
        status: 'native_fetch_failed',
        providerName: 'native_fetch',
      }),
    );
    assert.equal(ownEngineFailed(ctx), true);
    assert.equal(shouldTryExternalFetcher(ctx), true);
  });

  it('selectFetchProvider prioriza o provider nativo (motor próprio)', () => {
    const ctx = makeContext();
    const native = createNativeFetchProvider();
    const firecrawl = createFirecrawlProviderStub();
    const chosen = selectFetchProvider(ctx, [firecrawl, native]);
    assert.equal(chosen?.type, 'native');
    assert.equal(chosen?.name, 'native_fetch');
  });

  it('selectFetchProvider não escolhe externo desligado por padrão', () => {
    const ctx = makeContext({ budget: { maxNativeFetches: 0 } });
    const firecrawl = createFirecrawlProviderStub();
    // nativo sem orçamento e externo desligado → nenhum elegível
    const chosen = selectFetchProvider(ctx, [firecrawl]);
    assert.equal(chosen, null);
  });
});

// ─── NativeFetcher (provider principal) ──────────────────────────────────────

describe('NativeFetcher', () => {
  it('expõe type=native e enabled=true por padrão', () => {
    const native = createNativeFetchProvider();
    assert.equal(native.type, 'native');
    assert.equal(native.enabled, true);
    assert.equal(native.name, 'native_fetch');
  });

  it('adapta FetcherResult ok → success com html/text/finalUrl', async () => {
    const fakeFetcher: Fetcher = {
      async fetchText(): Promise<FetcherResult> {
        return {
          status: 'ok',
          httpStatus: 200,
          html: '<html><body><h1>Produto X</h1><p>R$ 10,00</p></body></html>',
          finalUrl: 'https://loja.test/p/123',
        };
      },
    };
    const native = createNativeFetchProvider({ fetcher: fakeFetcher });
    const res = await native.fetchPage({ url: 'https://loja.test/p/123' });
    assert.equal(res.status, 'success');
    assert.equal(res.httpStatus, 200);
    assert.equal(res.finalUrl, 'https://loja.test/p/123');
    assert.ok(res.html?.includes('Produto X'));
    assert.ok(res.text?.includes('Produto X'));
    assert.ok(!res.text?.includes('<h1>')); // tags removidas
    assert.ok(typeof res.elapsedMs === 'number');
  });

  it('mapeia blocked/requires_login → blocked e not_found → not_found', async () => {
    const blockedFetcher: Fetcher = {
      async fetchText(): Promise<FetcherResult> {
        return { status: 'blocked', httpStatus: 403 };
      },
    };
    const loginFetcher: Fetcher = {
      async fetchText(): Promise<FetcherResult> {
        return { status: 'requires_login', httpStatus: 401 };
      },
    };
    const notFoundFetcher: Fetcher = {
      async fetchText(): Promise<FetcherResult> {
        return { status: 'not_found', httpStatus: 404 };
      },
    };
    assert.equal(
      (await createNativeFetchProvider({ fetcher: blockedFetcher }).fetchPage({ url: 'u' })).status,
      'blocked',
    );
    assert.equal(
      (await createNativeFetchProvider({ fetcher: loginFetcher }).fetchPage({ url: 'u' })).status,
      'blocked',
    );
    assert.equal(
      (await createNativeFetchProvider({ fetcher: notFoundFetcher }).fetchPage({ url: 'u' })).status,
      'not_found',
    );
  });

  it('disabled quando enabled=false — não chama o fetcher', async () => {
    let called = false;
    const spyFetcher: Fetcher = {
      async fetchText(): Promise<FetcherResult> {
        called = true;
        return { status: 'ok', html: 'x' };
      },
    };
    const native = createNativeFetchProvider({ fetcher: spyFetcher, enabled: false });
    const res = await native.fetchPage({ url: 'u' });
    assert.equal(res.status, 'disabled');
    assert.equal(called, false);
  });
});

// ─── Stubs desligados ────────────────────────────────────────────────────────

describe('provider stubs (desligados)', () => {
  it('FirecrawlProviderStub retorna disabled/external_provider_disabled sem rede', async () => {
    const fc = createFirecrawlProviderStub();
    assert.equal(fc.enabled, false);
    assert.equal(fc.type, 'firecrawl');
    const res = await fc.fetchPage({ url: 'https://loja.test/p/1' });
    assert.equal(res.status, 'disabled');
    assert.equal(res.errorMessage, FIRECRAWL_DISABLED_REASON);
    assert.equal(res.elapsedMs, 0);
  });

  it('AIProviderStub retorna disabled/ai_provider_disabled sem rede', async () => {
    const ai = createAIProviderStub();
    assert.equal(ai.enabled, false);
    const res = await ai.interpretProduct({ query: 'notebook' });
    assert.equal(res.status, 'disabled');
    assert.equal(res.errorMessage, AI_DISABLED_REASON);
    assert.equal(res.extraction, undefined);
  });
});

// ─── Status interno → público ────────────────────────────────────────────────

describe('mapInternalStatusToPublicStatus', () => {
  it("'partial' e 'validated' mapeiam para V2 'validated' (útil)", () => {
    assert.equal(mapInternalStatusToPublicStatus('validated'), 'validated');
    assert.equal(mapInternalStatusToPublicStatus('partial'), 'validated');
    assert.equal(isUsefulInternalStatus('partial'), true);
    assert.equal(isUsefulInternalStatus('validated'), true);
    assert.equal(isUsefulInternalStatus('rejected'), false);
  });

  it('falha controlada não vira error genérico', () => {
    assert.equal(mapInternalStatusToPublicStatus('rejected'), 'product_mismatch');
    assert.equal(mapInternalStatusToPublicStatus('extraction_failed'), 'price_not_found');
    assert.equal(mapInternalStatusToPublicStatus('blocked'), 'blocked');
    assert.equal(mapInternalStatusToPublicStatus('timeout'), 'timeout');
    assert.equal(mapInternalStatusToPublicStatus('candidate_not_found'), 'not_found');
    assert.equal(
      mapInternalStatusToPublicStatus('external_provider_disabled'),
      'not_found',
    );
    assert.equal(mapInternalStatusToPublicStatus('ai_provider_disabled'), 'not_found');
    // só o crash de verdade vira 'error'
    assert.equal(mapInternalStatusToPublicStatus('error'), 'error');
  });

  it('isControlledFailureStatus distingue falha controlada de crash', () => {
    assert.equal(isControlledFailureStatus('blocked'), true);
    assert.equal(isControlledFailureStatus('rejected'), true);
    assert.equal(isControlledFailureStatus('extraction_failed'), true);
    assert.equal(isControlledFailureStatus('external_provider_disabled'), true);
    assert.equal(isControlledFailureStatus('ai_provider_disabled'), true);
    assert.equal(isControlledFailureStatus('error'), false); // crash genérico
    assert.equal(isControlledFailureStatus('validated'), false); // sucesso
  });

  it('é total: mapeia todos os status internos sem lançar', () => {
    for (const s of SEARCH_ENGINE_INTERNAL_STATUSES) {
      const pub = mapInternalStatusToPublicStatus(s);
      assert.ok(typeof pub === 'string' && pub.length > 0);
    }
  });
});

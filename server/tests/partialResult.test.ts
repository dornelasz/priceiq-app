/**
 * Etapa 3 — resultado parcial sem frete confirmado.
 *
 * Cobre os 7 cenários do contrato de resultado parcial:
 *  1. preço encontrado + frete desconhecido        → partial
 *  2. preço encontrado + frete grátis comprovado    → validated (completo)
 *  3. preço encontrado + frete confirmado           → validated (completo)
 *  4. sem preço                                     → falha (não validated/partial)
 *  5. frete desconhecido NUNCA vira 0
 *  6. total_brl fica null quando frete é desconhecido
 *  7. busca só com parciais NÃO é "sem dados" (route bucketing)
 *
 * Os cenários 1–6 testam a função pura mapUniversalResultToInsertPayload
 * (com convertToBrl injetado — não toca em currencyService nem rede/DB).
 * O cenário 7 testa o bucketing da rota /results com os predicados de status.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { mapUniversalResultToInsertPayload } = await import(
  '../suppliers/v2/integration/index.js'
);
const { isSuccessStatus, isPartialStatus } = await import('../lib/resultStatus.js');

type UniversalSearchResult =
  import('../suppliers/v2/index.js').UniversalSearchResult;
type FreightStatus = import('../suppliers/v2/index.js').FreightStatus;

// convertToBrl injetado: BRL→1:1, USD→×5. Nunca chama currencyService.
const convertToBrl = async (amount: number, currency: string) => {
  if (currency === 'BRL') return { brl: amount, rate: 1 };
  if (currency === 'USD') return { brl: parseFloat((amount * 5).toFixed(4)), rate: 5 };
  return { brl: amount, rate: 0 };
};

function makeUniversal(over: Partial<UniversalSearchResult> = {}): UniversalSearchResult {
  return {
    found: true,
    status: 'validated',
    productName: 'Monitor LG UltraGear 27"',
    price: 1200,
    currency: 'BRL',
    freight: null,
    freightStatus: 'not_available',
    totalPrice: null,
    productUrl: 'https://loja.com/produto/monitor-lg',
    linkType: 'product',
    linkValidated: true,
    matchScore: 85,
    confidence: 90,
    available: true,
    warning: null,
    errorMessage: null,
    evidence: {
      sourceUrl: 'https://loja.com/produto/monitor-lg',
      sourceName: 'v2_recipe_runner',
      evidenceText: 'JSON-LD Product · price=1200 BRL',
      extractedAt: '2026-05-24T12:00:00.000Z',
      strategy: 'json_ld',
    },
    ...over,
  };
}

// ─── 1. preço + frete desconhecido = parcial ───────────────────────────

describe('partial — preço encontrado, frete desconhecido', () => {
  it('status=partial, total_brl ausente, price_brl presente, freight ausente', async () => {
    const u = makeUniversal({ freight: null, freightStatus: 'not_available' });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });

    assert.equal(p.status, 'partial');
    assert.equal(p.found, true);
    assert.equal(p.price, 1200);
    assert.equal(p.currency, 'BRL');
    assert.equal(p.priceBrl, 1200);        // preço convertido (sem frete)
    assert.equal(p.totalBrl, undefined);   // total não confirmável
    assert.equal(p.totalPrice, undefined);
    assert.equal(p.freight, undefined);    // (5) nunca 0
    assert.match(p.warning ?? '', /frete a confirmar/i);
  });

  it('mantém link validado e evidência (é um resultado útil, não falha)', async () => {
    const u = makeUniversal();
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.linkType, 'product');
    assert.equal(p.linkValidated, true);
    assert.ok(p.evidenceText && p.evidenceText.length > 0);
  });

  it('moeda estrangeira: price_brl convertido, total_brl ainda ausente', async () => {
    const u = makeUniversal({ currency: 'USD', price: 100, freightStatus: 'not_available' });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'partial');
    assert.equal(p.priceBrl, 500);         // 100 USD × 5
    assert.equal(p.exchangeRateUsed, 5);
    assert.equal(p.totalBrl, undefined);
  });
});

// ─── 2. preço + frete grátis comprovado = completo ──────────────────────

describe('completo — preço + frete grátis confirmado', () => {
  it('status=validated, freight=0, total_brl = price_brl', async () => {
    const u = makeUniversal({ freight: 0, freightStatus: 'free_confirmed', totalPrice: 1200 });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'validated');
    assert.equal(p.freight, 0);
    assert.equal(p.totalPrice, 1200);
    assert.equal(p.totalBrl, 1200);
    assert.equal(p.priceBrl, 1200);
  });
});

// ─── 3. preço + frete confirmado = completo ─────────────────────────────

describe('completo — preço + frete confirmado (valor > 0)', () => {
  it('status=validated, total_brl = (price+freight) convertido', async () => {
    const u = makeUniversal({ freight: 50, freightStatus: 'confirmed', totalPrice: 1250 });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'validated');
    assert.equal(p.freight, 50);
    assert.equal(p.totalPrice, 1250);
    assert.equal(p.totalBrl, 1250);
    assert.equal(p.priceBrl, 1200);        // price_brl é só o preço, sem frete
  });

  it('moeda estrangeira confirmada: total e price em BRL coerentes', async () => {
    const u = makeUniversal({
      currency: 'USD', price: 100, freight: 20, freightStatus: 'confirmed', totalPrice: 120,
    });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'validated');
    assert.equal(p.priceBrl, 500);         // 100 × 5
    assert.equal(p.totalBrl, 600);         // 120 × 5
  });
});

// ─── 4. sem preço = falha ───────────────────────────────────────────────

describe('falha — sem preço não é partial nem validated', () => {
  it('price_not_found → status de falha, sem total nem price_brl', async () => {
    const u = makeUniversal({
      found: false,
      status: 'price_not_found',
      price: null,
      errorMessage: 'preço não encontrado com segurança',
    });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'price_not_found');
    assert.equal(isSuccessStatus(p.status), false);
    assert.equal(isPartialStatus(p.status), false);
    assert.equal(p.priceBrl, undefined);
    assert.equal(p.totalBrl, undefined);
  });

  it('not_found → status de falha', async () => {
    const u = makeUniversal({ found: false, status: 'not_found', price: null });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.status, 'not_found');
    assert.equal(isPartialStatus(p.status), false);
  });
});

// ─── 5 + 6. frete desconhecido nunca vira 0; total_brl null ─────────────

describe('invariantes de frete', () => {
  it('not_available e estimated NUNCA produzem freight=0', async () => {
    for (const fs of ['not_available', 'estimated'] as FreightStatus[]) {
      const u = makeUniversal({ freight: null, freightStatus: fs });
      const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
      assert.notEqual(p.freight, 0, `freight não pode ser 0 em ${fs}`);
      assert.equal(p.freight, undefined, `freight deve ser ausente em ${fs}`);
      assert.equal(p.totalBrl, undefined, `total_brl deve ser null em ${fs}`);
      assert.equal(p.status, 'partial', `${fs} deve ser parcial`);
    }
  });

  it('só frete grátis COMPROVADO permite freight=0', async () => {
    const u = makeUniversal({ freight: 0, freightStatus: 'free_confirmed', totalPrice: 1200 });
    const p = await mapUniversalResultToInsertPayload({ result: u, convertToBrl });
    assert.equal(p.freight, 0);
    assert.equal(p.status, 'validated');
  });
});

// ─── 7. busca só com parciais não é "sem dados" ─────────────────────────
//
// Replica o bucketing da rota GET /api/searches/:id/results.

interface RowLike {
  status: import('../lib/resultStatus.js').ResultStatus;
  total_brl: number | null;
}

function bucket(all: RowLike[]) {
  const valid = all.filter((r) => isSuccessStatus(r.status) && r.total_brl !== null);
  const partials = all.filter((r) => isPartialStatus(r.status));
  const failed = all.filter((r) => !isSuccessStatus(r.status) && !isPartialStatus(r.status));
  return { valid, partials, failed, best: valid[0] ?? null };
}

describe('busca só com parciais — bucketing da rota', () => {
  it('parciais aparecem em partials, não em errors; best é null mas não é vazio', () => {
    const all: RowLike[] = [
      { status: 'partial', total_brl: null },
      { status: 'partial', total_brl: null },
    ];
    const { valid, partials, failed, best } = bucket(all);
    assert.equal(partials.length, 2);   // há dados úteis
    assert.equal(failed.length, 0);     // nenhum erro
    assert.equal(valid.length, 0);      // nenhum completo
    assert.equal(best, null);           // parcial nunca é "melhor"
    // "não é sem dados": existe pelo menos um resultado para mostrar
    assert.ok(partials.length + valid.length > 0);
  });

  it('mistura completo + parcial + falha → buckets separados, best vem do completo', () => {
    const all: RowLike[] = [
      { status: 'validated', total_brl: 999 },
      { status: 'partial', total_brl: null },
      { status: 'blocked', total_brl: null },
    ];
    const { valid, partials, failed, best } = bucket(all);
    assert.equal(valid.length, 1);
    assert.equal(partials.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(best?.total_brl, 999);
  });
});

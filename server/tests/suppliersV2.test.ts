/**
 * Testes dos contratos e helpers da Fase A do Universal Supplier Adapter V2.
 *
 * Cobertura mínima:
 *  - Cada enum aceita valores oficiais e rejeita inválidos.
 *  - isValidatedUniversalSearchResult exige TODOS os campos do contrato.
 *  - canConfirmFinalTotal segue o modelo de frete em 3+1 estados.
 *  - Frete desconhecido NUNCA vira 0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPLIER_CERTIFICATION_STATUSES,
  SEARCH_RESULT_STATUSES_V2,
  FREIGHT_STATUSES,
  LINK_TYPES,
  EXTRACTION_STRATEGIES,
  supplierCertificationStatusSchema,
  searchResultStatusV2Schema,
  freightStatusSchema,
  linkTypeSchema,
  extractionStrategySchema,
  universalSearchResultSchema,
  supplierRecipeSchema,
  supplierAutoConfigResultSchema,
  isValidatedUniversalSearchResult,
  canConfirmFinalTotal,
  type UniversalSearchResult,
} from '../suppliers/v2/index.js';

// ─── Factories ──────────────────────────────────────────────────────────

function makeValidated(
  over: Partial<UniversalSearchResult> = {},
): UniversalSearchResult {
  return {
    found: true,
    status: 'validated',
    productName: 'Notebook Dell Inspiron 15',
    price: 4599.9,
    currency: 'BRL',
    freight: null,
    freightStatus: 'not_available',
    productUrl: 'https://loja.com.br/produto/notebook-dell-inspiron-15',
    linkType: 'product',
    linkValidated: true,
    evidence: {
      sourceUrl: 'https://loja.com.br/produto/notebook-dell-inspiron-15',
      sourceName: 'loja.com.br',
      evidenceText: 'Notebook Dell Inspiron 15 R$ 4.599,90 em estoque',
      extractedAt: '2026-05-22T12:00:00.000Z',
      strategy: 'json_ld',
    },
    ...over,
  };
}

// ─── 1. SupplierCertificationStatus ─────────────────────────────────────

describe('SupplierCertificationStatus — schema', () => {
  it('aceita todos os valores oficiais', () => {
    for (const s of SUPPLIER_CERTIFICATION_STATUSES) {
      assert.equal(supplierCertificationStatusSchema.parse(s), s);
    }
  });

  it('expõe os 8 status documentados', () => {
    assert.deepEqual([...SUPPLIER_CERTIFICATION_STATUSES], [
      'unconfigured',
      'auto_configuring',
      'certified',
      'needs_guided_setup',
      'blocked',
      'requires_login',
      'unsupported',
      'failed',
    ]);
  });

  it('rejeita status inválido', () => {
    assert.throws(() => supplierCertificationStatusSchema.parse('CERTIFIED'));
    assert.throws(() => supplierCertificationStatusSchema.parse('pending'));
    assert.throws(() => supplierCertificationStatusSchema.parse(''));
    assert.throws(() => supplierCertificationStatusSchema.parse(null));
  });
});

// ─── 2. SearchResultStatusV2 ────────────────────────────────────────────

describe('SearchResultStatusV2 — schema', () => {
  it('aceita todos os valores oficiais', () => {
    for (const s of SEARCH_RESULT_STATUSES_V2) {
      assert.equal(searchResultStatusV2Schema.parse(s), s);
    }
  });

  it('inclui needs_supplier_setup (novo status V2)', () => {
    assert.equal(
      searchResultStatusV2Schema.parse('needs_supplier_setup'),
      'needs_supplier_setup',
    );
  });

  it('rejeita status inválido', () => {
    assert.throws(() => searchResultStatusV2Schema.parse('Validated'));
    assert.throws(() => searchResultStatusV2Schema.parse('ok'));
    assert.throws(() => searchResultStatusV2Schema.parse(''));
  });
});

// ─── 3. FreightStatus ───────────────────────────────────────────────────

describe('FreightStatus — schema', () => {
  it('aceita todos os 4 estados oficiais', () => {
    for (const s of FREIGHT_STATUSES) {
      assert.equal(freightStatusSchema.parse(s), s);
    }
  });

  it('expõe exatamente: not_available, free_confirmed, confirmed, estimated', () => {
    assert.deepEqual([...FREIGHT_STATUSES], [
      'not_available',
      'free_confirmed',
      'confirmed',
      'estimated',
    ]);
  });

  it('rejeita valores antigos / inválidos', () => {
    assert.throws(() => freightStatusSchema.parse('free'));
    assert.throws(() => freightStatusSchema.parse('unknown'));
    assert.throws(() => freightStatusSchema.parse('paid'));
    assert.throws(() => freightStatusSchema.parse(''));
  });
});

// ─── LinkType / ExtractionStrategy (sanidade) ───────────────────────────

describe('LinkType — schema', () => {
  it('aceita product, search, category, unknown', () => {
    for (const s of LINK_TYPES) {
      assert.equal(linkTypeSchema.parse(s), s);
    }
  });

  it('rejeita linkType inválido', () => {
    assert.throws(() => linkTypeSchema.parse('detail'));
    assert.throws(() => linkTypeSchema.parse('home'));
  });
});

describe('ExtractionStrategy — schema', () => {
  it('aceita todas as estratégias oficiais', () => {
    for (const s of EXTRACTION_STRATEGIES) {
      assert.equal(extractionStrategySchema.parse(s), s);
    }
  });

  it('rejeita estratégia inválida', () => {
    assert.throws(() => extractionStrategySchema.parse('regex'));
    assert.throws(() => extractionStrategySchema.parse('ai'));
  });
});

// ─── 7. isValidatedUniversalSearchResult — caso positivo ────────────────

describe('isValidatedUniversalSearchResult', () => {
  it('aceita UniversalSearchResult validated completo', () => {
    assert.equal(isValidatedUniversalSearchResult(makeValidated()), true);
  });

  it('aceita validated mesmo com freightStatus="not_available"', () => {
    // Frete não é critério de validated
    const r = makeValidated({ freightStatus: 'not_available', freight: null });
    assert.equal(isValidatedUniversalSearchResult(r), true);
  });

  // ─── 8. evidence ausente ─────────────────────────────────────────────
  it('rejeita quando evidence é undefined', () => {
    const r = makeValidated();
    delete (r as Partial<UniversalSearchResult>).evidence;
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita quando evidence é null', () => {
    const r = makeValidated({ evidence: null });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita quando evidence.evidenceText é vazio', () => {
    const r = makeValidated({
      evidence: {
        sourceUrl: 'https://x.com',
        evidenceText: '',
        extractedAt: '2026-05-22T12:00:00.000Z',
        strategy: 'json_ld',
      },
    });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  // ─── 9. linkType !== product ─────────────────────────────────────────
  it('rejeita quando linkType="search"', () => {
    const r = makeValidated({ linkType: 'search' });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita quando linkType="category"', () => {
    const r = makeValidated({ linkType: 'category' });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  // ─── 10. linkValidated=false ─────────────────────────────────────────
  it('rejeita quando linkValidated=false', () => {
    const r = makeValidated({ linkValidated: false });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  // ─── Demais campos obrigatórios ──────────────────────────────────────
  it('rejeita quando found=false', () => {
    const r = makeValidated({ found: false });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita quando status !== "validated"', () => {
    const r = makeValidated({ status: 'cached' });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita sem productName', () => {
    const r = makeValidated();
    delete (r as Partial<UniversalSearchResult>).productName;
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita productName vazio', () => {
    const r = makeValidated({ productName: '   ' });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita price 0', () => {
    const r = makeValidated({ price: 0 });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita price negativo', () => {
    const r = makeValidated({ price: -1 });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita sem currency', () => {
    const r = makeValidated({ currency: null });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });

  it('rejeita sem productUrl', () => {
    const r = makeValidated({ productUrl: null });
    assert.equal(isValidatedUniversalSearchResult(r), false);
  });
});

// ─── 11. freightStatus="not_available" aceita freight=null ──────────────

describe('UniversalSearchResult — schema + frete', () => {
  it('aceita freightStatus="not_available" com freight=null', () => {
    const parsed = universalSearchResultSchema.parse({
      ...makeValidated(),
      freightStatus: 'not_available',
      freight: null,
    });
    assert.equal(parsed.freightStatus, 'not_available');
    assert.equal(parsed.freight, null);
  });

  it('aceita freightStatus="not_available" sem campo freight', () => {
    const r = makeValidated({ freightStatus: 'not_available' });
    delete (r as Partial<UniversalSearchResult>).freight;
    const parsed = universalSearchResultSchema.parse(r);
    assert.equal(parsed.freightStatus, 'not_available');
  });

  // ─── 12. free_confirmed aceita freight=0 ──────────────────────────────
  it('aceita freightStatus="free_confirmed" com freight=0', () => {
    const parsed = universalSearchResultSchema.parse({
      ...makeValidated(),
      freightStatus: 'free_confirmed',
      freight: 0,
    });
    assert.equal(parsed.freightStatus, 'free_confirmed');
    assert.equal(parsed.freight, 0);
  });

  it('rejeita freightStatus="free_confirmed" com freight=10', () => {
    assert.throws(() =>
      universalSearchResultSchema.parse({
        ...makeValidated(),
        freightStatus: 'free_confirmed',
        freight: 10,
      }),
    );
  });

  it('aceita freightStatus="confirmed" com freight=29.9', () => {
    const parsed = universalSearchResultSchema.parse({
      ...makeValidated(),
      freightStatus: 'confirmed',
      freight: 29.9,
    });
    assert.equal(parsed.freightStatus, 'confirmed');
    assert.equal(parsed.freight, 29.9);
  });

  it('rejeita freightStatus="confirmed" com freight=0 (deveria ser free_confirmed)', () => {
    assert.throws(() =>
      universalSearchResultSchema.parse({
        ...makeValidated(),
        freightStatus: 'confirmed',
        freight: 0,
      }),
    );
  });

  it('rejeita freightStatus="confirmed" com freight=null (frete desconhecido NUNCA vira número)', () => {
    assert.throws(() =>
      universalSearchResultSchema.parse({
        ...makeValidated(),
        freightStatus: 'confirmed',
        freight: null,
      }),
    );
  });

  it('rejeita freightStatus="not_available" com freight=5 (frete desconhecido não pode ter número)', () => {
    assert.throws(() =>
      universalSearchResultSchema.parse({
        ...makeValidated(),
        freightStatus: 'not_available',
        freight: 5,
      }),
    );
  });

  it('aceita freightStatus="estimated" com freight=15', () => {
    const parsed = universalSearchResultSchema.parse({
      ...makeValidated(),
      freightStatus: 'estimated',
      freight: 15,
    });
    assert.equal(parsed.freightStatus, 'estimated');
  });
});

// ─── 13–15. canConfirmFinalTotal ────────────────────────────────────────

describe('canConfirmFinalTotal', () => {
  it('retorna false quando freightStatus="not_available"', () => {
    const r = makeValidated({ freightStatus: 'not_available', freight: null });
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('retorna true quando freightStatus="free_confirmed" e freight=0', () => {
    const r = makeValidated({ freightStatus: 'free_confirmed', freight: 0 });
    assert.equal(canConfirmFinalTotal(r), true);
  });

  it('retorna true quando freightStatus="confirmed" e freight válido', () => {
    const r = makeValidated({ freightStatus: 'confirmed', freight: 29.9 });
    assert.equal(canConfirmFinalTotal(r), true);
  });

  it('retorna false quando freightStatus="estimated" (estimativa NÃO confirma total)', () => {
    const r = makeValidated({ freightStatus: 'estimated', freight: 15 });
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('retorna false quando freightStatus="confirmed" mas freight=0', () => {
    // Inconsistência: confirmed exige > 0; 0 só é válido com free_confirmed.
    const r = makeValidated({ freightStatus: 'confirmed', freight: 0 });
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('retorna false quando freightStatus="confirmed" mas freight=null', () => {
    const r = makeValidated({ freightStatus: 'confirmed', freight: null });
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('retorna false quando price ausente', () => {
    const r = makeValidated({
      price: null,
      freightStatus: 'confirmed',
      freight: 10,
    });
    assert.equal(canConfirmFinalTotal(r), false);
  });

  it('retorna false quando price 0', () => {
    const r = makeValidated({
      price: 0,
      freightStatus: 'confirmed',
      freight: 10,
    });
    assert.equal(canConfirmFinalTotal(r), false);
  });
});

// ─── SupplierRecipe / SupplierAutoConfigResult (sanidade de contrato) ───

describe('SupplierRecipe — schema', () => {
  it('aceita receita mínima (apenas supplierId + status)', () => {
    const r = supplierRecipeSchema.parse({
      supplierId: 'sup-1',
      status: 'unconfigured',
    });
    assert.equal(r.supplierId, 'sup-1');
    assert.equal(r.status, 'unconfigured');
  });

  it('aceita receita certified completa', () => {
    const r = supplierRecipeSchema.parse({
      supplierId: 'sup-1',
      status: 'certified',
      platformDetected: 'mercadolivre',
      searchUrlTemplate: 'https://mercadolivre.com.br/jm/search?as_word={q}',
      productUrlPatterns: ['^https://produto\\.mercadolivre\\.com\\.br/'],
      extractionStrategy: 'specialized_adapter',
      priceSelector: '.andes-money-amount',
      jsonLdEnabled: true,
      confidence: 95,
      requiresBrowser: false,
    });
    assert.equal(r.status, 'certified');
    assert.equal(r.confidence, 95);
  });

  it('rejeita status inválido', () => {
    assert.throws(() =>
      supplierRecipeSchema.parse({
        supplierId: 'sup-1',
        status: 'ready',
      }),
    );
  });

  it('rejeita supplierId vazio', () => {
    assert.throws(() =>
      supplierRecipeSchema.parse({
        supplierId: '',
        status: 'certified',
      }),
    );
  });
});

describe('SupplierAutoConfigResult — schema', () => {
  it('aceita resultado sem recipe (falha de auto-config)', () => {
    const r = supplierAutoConfigResultSchema.parse({
      supplierId: 'sup-1',
      status: 'needs_guided_setup',
      error: 'platform não detectada',
    });
    assert.equal(r.status, 'needs_guided_setup');
  });

  it('aceita resultado certified com recipe encadeada', () => {
    const r = supplierAutoConfigResultSchema.parse({
      supplierId: 'sup-1',
      status: 'certified',
      platformDetected: 'amazon_br',
      confidence: 95,
      recipe: {
        supplierId: 'sup-1',
        status: 'certified',
        extractionStrategy: 'specialized_adapter',
      },
    });
    assert.equal(r.recipe?.supplierId, 'sup-1');
  });
});

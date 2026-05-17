/**
 * Testes do fluxo de duas fases: extractCandidates + extractProductPage.
 * Sem rede — usa conteúdo inline.
 */
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '../scrapers/productCandidateExtractor.js';
import { extractTopCandidates } from '../scrapers/directExtractor.js';
import type { Supplier } from '../services/supplierService.js';

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Mercado Livre',
    site: 'mercadolivre.com.br',
    search_url_template: 'https://lista.mercadolivre.com.br/{q}',
    country: 'Brasil',
    currency: 'BRL',
    type: 'Nacional',
    active: true,
    extraction_mode: 'jina_reader',
    extractor_config: {},
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

const PAD = '\n' + 'Texto de padding para atingir comprimento mínimo. '.repeat(4) + '\n';

const SEARCH_MD = `
# Resultados: iPhone 13 128GB
${PAD}
iPhone 13 Apple 128GB Tela 6.1 Câmera Dupla Meia Noite
[Ver produto](https://produto.mercadolivre.com.br/MLB-1234567890-iphone-13-128gb)
R$ 2.799,00

iPhone 13 128GB Estelar Apple Original
[Ver](https://produto.mercadolivre.com.br/MLB-9876543210-iphone-13-estelar)
R$ 2.850,00

Capinha para iPhone 13 silicone proteção
[Ver](https://produto.mercadolivre.com.br/MLB-2222222222-capinha-iphone13)
R$ 39,90
${PAD}
`;

const SEARCH_URL = 'https://lista.mercadolivre.com.br/iphone-13-128gb';

describe('extractTopCandidates — Fase 1', () => {
  it('extrai candidatos com URL absoluta de produto', () => {
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 3);
    assert.ok(candidates.length > 0, 'deve encontrar pelo menos 1 candidato');
    for (const c of candidates) {
      assert.ok(c.url.startsWith('http'), `URL deve ser absoluta: ${c.url}`);
      assert.ok(c.name.length > 4, `nome muito curto: ${c.name}`);
      assert.ok(c.matchScore >= 0, 'matchScore deve ser >= 0');
    }
  });

  it('candidatos ordenados por matchScore decrescente', () => {
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 3);
    for (let i = 1; i < candidates.length; i++) {
      assert.ok(
        (candidates[i - 1]?.matchScore ?? 0) >= (candidates[i]?.matchScore ?? 0),
        'candidatos devem estar em ordem de matchScore decrescente',
      );
    }
  });

  it('exclui acessório (capinha) quando a query não é acessório', () => {
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 3);
    const accessory = candidates.find((c) => /capinha/i.test(c.name));
    assert.equal(accessory, undefined, 'acessório não deve aparecer nos candidatos');
  });

  it('respeita maxCandidates', () => {
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 2);
    assert.ok(candidates.length <= 2, `máximo de 2, recebeu ${candidates.length}`);
  });

  it('retorna [] para conteúdo vazio', () => {
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13', '', SEARCH_URL, 3);
    assert.equal(candidates.length, 0);
  });

  it('retorna [] quando não há URL de produto no conteúdo', () => {
    const sup = supplier();
    const content = PAD + 'iPhone 13 128GB R$ 2.799,00 sem link de produto' + PAD;
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', content, SEARCH_URL, 3);
    assert.equal(candidates.length, 0);
  });
});

describe('extractCandidates — wrapper de Fase 1', () => {
  it('adiciona sourceUrl e position aos candidatos', () => {
    const sup = supplier();
    const candidates = extractCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 3);
    for (let i = 0; i < candidates.length; i++) {
      assert.equal(candidates[i]?.sourceUrl, SEARCH_URL);
      assert.equal(candidates[i]?.position, i);
    }
  });

  it('candndidatos têm URL absoluta iniciando com https', () => {
    const sup = supplier();
    const candidates = extractCandidates(sup, 'iphone 13 128gb', SEARCH_MD, SEARCH_URL, 3);
    for (const c of candidates) {
      assert.ok(c.url.startsWith('https://'), `URL deve iniciar com https://: ${c.url}`);
    }
  });
});

describe('extractTopCandidates — JSON-LD', () => {
  it('extrai candidatos de JSON-LD Product com URL', () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'iPhone 13 128GB Apple Meia Noite',
      url: 'https://produto.mercadolivre.com.br/MLB-1234567890-iphone-13',
      offers: { '@type': 'Offer', price: '2799.00', priceCurrency: 'BRL' },
    });
    const content = PAD + `<script type="application/ld+json">${jsonLd}</script>` + PAD;
    const sup = supplier();
    const candidates = extractTopCandidates(sup, 'iphone 13 128gb', content, SEARCH_URL, 3);
    assert.ok(candidates.length > 0, 'deve extrair candidato do JSON-LD');
    assert.ok(candidates[0]?.url.includes('MLB'), `URL deve conter padrão MLB: ${candidates[0]?.url}`);
    assert.ok(candidates[0]?.price && candidates[0].price > 0, 'preço deve ser positivo');
  });
});

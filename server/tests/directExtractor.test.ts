/**
 * Testes do Motor Universal de Extração (sem DB, sem IA, sem rede).
 * Roda com: npm run test
 */
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractDirectly, detectShipping } from '../scrapers/directExtractor.js';
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

const PAD = '\n\n' + 'Lorem ipsum dolor sit amet consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.'.repeat(2) + '\n\n';

describe('directExtractor — preço em markdown Jina', () => {
  it('extrai produto principal com preço BRL e URL /MLB', () => {
    const md = `
# Resultados de busca no Mercado Livre
${PAD}
iPhone 13 Apple 128GB Tela 6.1 Câmera Dupla
[Ver produto](https://produto.mercadolivre.com.br/MLB-1234567890-iphone-13-128gb)
R$ 2.799,00 em 12x R$ 233,25

Capinha para iPhone 13 silicone
[Ver](https://produto.mercadolivre.com.br/MLB-2222222222-capinha)
R$ 39,90
`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', md, 'https://lista.mercadolivre.com.br/iphone-13-128gb');
    assert.equal(r.found, true);
    assert.equal(r.currency, 'BRL');
    assert.ok(r.price && r.price > 1000 && r.price < 5000, `preço esperado ~2799, recebeu ${r.price}`);
    assert.ok(r.evidenceText && r.evidenceText.length > 5);
    assert.ok(r.link?.includes('/MLB'));
  });

  it('rejeita quando só há acessório (capinha)', () => {
    const md = `${PAD}
Capinha para iPhone 13 silicone preta
[Ver](https://produto.mercadolivre.com.br/MLB-9999999999-capinha)
R$ 39,90
${PAD}`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', md, 'https://lista.mercadolivre.com.br/iphone-13-128gb');
    assert.equal(r.found, false, 'deveria rejeitar acessório');
  });

  it('rejeita conteúdo curto demais', () => {
    const r = extractDirectly(supplier(), 'iphone', 'curto', 'https://x.com');
    assert.equal(r.found, false);
    assert.match(r.errorMessage ?? '', /conteúdo suficiente/i);
  });

  it('não confunde 4.8 estrelas com preço', () => {
    const md = `${PAD}
iPhone 13 Apple 128GB Tela 6.1
Avaliação 4.8 estrelas (1234 avaliações)
[Ver](https://produto.mercadolivre.com.br/MLB-7777777777-iphone)
R$ 2.799,00
${PAD}`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', md, 'https://x');
    assert.ok(r.found, 'deveria achar produto');
    assert.ok(r.price && r.price > 1000, `pegou o preço correto, não o 4.8 — recebeu ${r.price}`);
  });

  it('não confunde 128GB com preço', () => {
    const md = `${PAD}
iPhone 13 Apple 128GB Smartphone Tela 6.1
[Ver](https://produto.mercadolivre.com.br/MLB-8888888888-iphone)
R$ 2.799,00
${PAD}`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', md, 'https://x');
    assert.ok(r.price && r.price > 1000);
    assert.notEqual(r.price, 128);
  });
});

describe('directExtractor — JSON-LD schema.org', () => {
  it('extrai Product de application/ld+json', () => {
    const html = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "iPhone 13 Apple 128GB Azul",
  "url": "https://www.mercadolivre.com.br/iphone-13-128gb-azul/p/MLB12345678",
  "offers": {
    "@type": "Offer",
    "price": "2799.00",
    "priceCurrency": "BRL",
    "availability": "https://schema.org/InStock"
  }
}
</script>
</head><body>algum conteúdo extra com mais de 200 chars para passar o limite mínimo. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</body></html>
`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', html, 'https://lista.mercadolivre.com.br/iphone-13-128gb');
    assert.equal(r.found, true);
    assert.equal(r.price, 2799);
    assert.equal(r.currency, 'BRL');
    assert.ok(r.sourceName?.includes('json-ld'));
  });

  it('extrai Product de @graph com Offer', () => {
    const html = `
<html><body>${'x'.repeat(200)}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {"@type": "WebPage", "name": "Página"},
    {"@type": "Product", "name": "Placa Mãe B550 Aorus Elite", "offers": {"price": 899.90, "priceCurrency": "BRL"}}
  ]
}
</script>
</body></html>
`;
    const r = extractDirectly(supplier(), 'placa mae b550', html, 'https://kabum.com.br/busca/b550');
    assert.equal(r.found, true);
    assert.equal(r.price, 899.9);
  });
});

describe('directExtractor — frete', () => {
  it('detecta frete grátis em PT', () => {
    const md = `${PAD}
Smart TV 55 polegadas LG OLED 4K
[Ver](https://produto.mercadolivre.com.br/MLB-5555555555-tv-lg-oled)
R$ 4.999,00
Frete grátis para todo o Brasil
${PAD}`;
    const r = extractDirectly(supplier(), 'smart tv 55 lg oled', md, 'https://x');
    assert.equal(r.found, true);
    assert.match(r.warning ?? '', /frete\s+gr[áa]tis\s+confirmado/i);
  });

  it('warning quando frete não encontrado', () => {
    const md = `${PAD}
Smart TV 55 polegadas LG OLED 4K
[Ver](https://produto.mercadolivre.com.br/MLB-5555555555-tv-lg-oled)
R$ 4.999,00
${PAD}`;
    const r = extractDirectly(supplier(), 'smart tv 55 lg oled', md, 'https://x');
    assert.equal(r.found, true);
    assert.match(r.warning ?? '', /frete não encontrado/i);
  });

  it('detectShipping detecta "free shipping"', () => {
    const { freight, freightNote } = detectShipping('Apple Watch — free shipping worldwide', 'USD');
    assert.equal(freight, 0);
    assert.equal(freightNote, 'frete grátis confirmado');
  });

  it('detectShipping detecta valor pago em BRL', () => {
    const { freight, freightNote } = detectShipping('Produto incrível · Frete R$ 25,90 para SP', 'BRL');
    assert.equal(freight, 25.9);
    assert.equal(freightNote, 'frete encontrado');
  });
});

describe('directExtractor — moedas internacionais', () => {
  it('extrai USD em formato US$ 123.45', () => {
    const sup = supplier({ name: 'Amazon USA', site: 'amazon.com', currency: 'USD' });
    const md = `${PAD}
Apple AirPods Pro 2nd Generation Wireless Earbuds
[Ver](https://www.amazon.com/dp/B0BDHWDR12)
US$ 199.99
${PAD}`;
    const r = extractDirectly(sup, 'airpods pro', md, 'https://amazon.com/s?k=airpods');
    assert.equal(r.found, true);
    assert.equal(r.currency, 'USD');
    assert.equal(r.price, 199.99);
  });

  it('extrai EUR em € 199,90', () => {
    const sup = supplier({ name: 'Loja DE', site: 'amazon.de', currency: 'EUR' });
    const md = `${PAD}
Apple AirPods Pro Wireless Earbuds
[Ver](https://www.amazon.de/dp/B0BDHWDR12)
€ 199,90
${PAD}`;
    const r = extractDirectly(sup, 'airpods pro', md, 'https://amazon.de/s?k=airpods');
    assert.equal(r.found, true);
    assert.equal(r.currency, 'EUR');
    assert.ok(r.price && Math.abs(r.price - 199.9) < 0.01);
  });
});

describe('directExtractor — sem evidência', () => {
  it('rejeita quando não há preço no conteúdo', () => {
    const md = `${PAD}
iPhone 13 Apple 128GB
[Ver](https://produto.mercadolivre.com.br/MLB-1234567890-iphone-13-128gb)
Indisponível no momento.
${PAD}`;
    const r = extractDirectly(supplier(), 'iphone 13 128gb', md, 'https://x');
    assert.equal(r.found, false);
  });
});

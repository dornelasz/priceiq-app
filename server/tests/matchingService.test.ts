process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test@localhost/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchingService } from '../services/matchingService.js';

describe('matchingService', () => {
  it('detecta acessório quando query é produto principal', () => {
    const r = matchingService.score('iphone 13 128gb', 'Capinha para iPhone 13 silicone preta');
    assert.equal(r.isLikelyAccessory, true);
  });

  it('NÃO marca acessório quando a query pede o acessório', () => {
    const r = matchingService.score('capinha iphone 13', 'Capinha para iPhone 13 silicone');
    assert.equal(r.isLikelyAccessory, false);
  });

  it('score alto quando todos os tokens batem', () => {
    const r = matchingService.score('iphone 13 128gb', 'iPhone 13 Apple 128GB Tela 6.1');
    assert.ok(r.score >= 75, `esperado ≥75, recebeu ${r.score}`);
  });

  it('score baixo quando só metade dos tokens batem', () => {
    const r = matchingService.score('placa mae b550 aorus elite', 'Placa Mãe B450 ASUS');
    assert.ok(r.score < 50, `esperado <50, recebeu ${r.score}`);
  });

  it('penaliza acessório mesmo com tokens batendo', () => {
    const r = matchingService.score('iphone 13 128gb', 'Cabo Lightning para iPhone 13 128gb compatível');
    assert.ok(r.score < 75, `esperado <75 (acessório), recebeu ${r.score}`);
    assert.equal(r.isLikelyAccessory, true);
  });

  it('cacheKey normaliza espaços e acentos', () => {
    assert.equal(matchingService.cacheKey('  Placa Mãe B550  '), 'placa mae b550');
    assert.equal(matchingService.cacheKey('iPhone 13 128GB'), 'iphone 13 128gb');
  });
});

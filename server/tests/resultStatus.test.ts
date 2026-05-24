import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWorkerStatus,
  isSuccessStatus,
  isPartialStatus,
  isUsefulStatus,
  type ResultStatus,
} from '../lib/resultStatus.js';

describe('resultStatus — isSuccessStatus', () => {
  it('considera validated e cached como sucesso completo', () => {
    assert.equal(isSuccessStatus('validated'), true);
    assert.equal(isSuccessStatus('cached'), true);
  });

  it('partial NÃO é sucesso completo (não concorre a melhor preço)', () => {
    assert.equal(isSuccessStatus('partial'), false);
  });

  it('considera todos os outros como falha', () => {
    const failures: ResultStatus[] = [
      'not_found', 'blocked', 'invalid_link',
      'price_not_found', 'product_mismatch', 'timeout', 'error',
    ];
    for (const s of failures) assert.equal(isSuccessStatus(s), false);
    assert.equal(isSuccessStatus(null), false);
    assert.equal(isSuccessStatus(undefined), false);
  });
});

describe('resultStatus — isPartialStatus / isUsefulStatus', () => {
  it('isPartialStatus só é true para partial', () => {
    assert.equal(isPartialStatus('partial'), true);
    assert.equal(isPartialStatus('validated'), false);
    assert.equal(isPartialStatus('cached'), false);
    assert.equal(isPartialStatus('error'), false);
    assert.equal(isPartialStatus(null), false);
  });

  it('isUsefulStatus inclui validated, cached e partial', () => {
    assert.equal(isUsefulStatus('validated'), true);
    assert.equal(isUsefulStatus('cached'), true);
    assert.equal(isUsefulStatus('partial'), true);
  });

  it('isUsefulStatus exclui falhas reais', () => {
    const failures: ResultStatus[] = [
      'not_found', 'blocked', 'invalid_link',
      'price_not_found', 'product_mismatch', 'timeout', 'error',
    ];
    for (const s of failures) assert.equal(isUsefulStatus(s), false);
    assert.equal(isUsefulStatus(null), false);
  });
});

describe('resultStatus — deriveWorkerStatus', () => {
  it('cache hit válido → cached', () => {
    const s = deriveWorkerStatus({
      fromCache: true, found: true, hasPrice: true, hasCurrency: true,
      scraperStatus: 'validated',
    });
    assert.equal(s, 'cached');
  });

  it('scraper já marcou validated → validated', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: true, hasPrice: true, hasCurrency: true,
      scraperStatus: 'validated',
    });
    assert.equal(s, 'validated');
  });

  it('sucesso sem status do scraper → assume validated', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: true, hasPrice: true, hasCurrency: true,
    });
    assert.equal(s, 'validated');
  });

  it('scraper devolveu blocked → preserva blocked', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: false, hasPrice: false, hasCurrency: false,
      scraperStatus: 'blocked',
    });
    assert.equal(s, 'blocked');
  });

  it('scraper devolveu product_mismatch → preserva', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: false, hasPrice: false, hasCurrency: false,
      scraperStatus: 'product_mismatch',
    });
    assert.equal(s, 'product_mismatch');
  });

  it('falha sem status do scraper → error', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: false, hasPrice: false, hasCurrency: false,
    });
    assert.equal(s, 'error');
  });

  it('found mas sem preço → não é validated', () => {
    const s = deriveWorkerStatus({
      fromCache: false, found: true, hasPrice: false, hasCurrency: true,
      scraperStatus: 'price_not_found',
    });
    assert.equal(s, 'price_not_found');
  });

  it('cache hit mas inválido (faltam dados) → status do scraper', () => {
    const s = deriveWorkerStatus({
      fromCache: true, found: false, hasPrice: false, hasCurrency: false,
      scraperStatus: 'blocked',
    });
    assert.equal(s, 'blocked');
  });
});

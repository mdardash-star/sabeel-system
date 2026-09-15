import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlement } from '../src/finance/settlement.mjs';

test('calculates percentage payout from pre-VAT margin', () => {
  const result = calculateSettlement({
    saleExVat: 1000,
    productCost: 500,
    otherCosts: 100,
    mode: 'percentage',
    commissionRate: 0.30,
    policyVersion: 'initial-1'
  });
  assert.equal(result.margin, 400);
  assert.equal(result.payoutAmount, 120);
});

test('supports fixed payout', () => {
  const result = calculateSettlement({
    saleExVat: 500,
    productCost: 300,
    mode: 'fixed',
    fixedAmount: 80,
    policyVersion: 'fixed-1'
  });
  assert.equal(result.payoutAmount, 80);
});

test('rejects percentage above policy ceiling', () => {
  assert.throws(() => calculateSettlement({
    saleExVat: 1000,
    productCost: 500,
    mode: 'percentage',
    commissionRate: 0.55,
    policyVersion: 'invalid'
  }));
});

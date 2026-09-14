export function calculateSettlement(input) {
  const sale = Number(input.saleExVat);
  const product = Number(input.productCost);
  const other = Number(input.otherCosts || 0);
  const margin = Math.max(0, sale - product - other);

  let payout;
  if (input.mode === 'fixed') {
    payout = Number(input.fixedAmount || 0);
  } else {
    const rate = Number(input.commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
      throw new Error('Commission rate must be between 0 and 0.5');
    }
    payout = margin * rate;
  }

  return {
    saleExVat: roundMoney(sale),
    productCost: roundMoney(product),
    otherCosts: roundMoney(other),
    margin: roundMoney(margin),
    payoutAmount: roundMoney(Math.max(0, payout)),
    policyVersion: input.policyVersion
  };
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

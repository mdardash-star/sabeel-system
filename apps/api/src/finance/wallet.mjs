export function approveSettlement(settlement, approverUserId, now = new Date()) {
  if (settlement.status !== 'pending_approval') throw new Error('Settlement is not pending approval');
  if (!approverUserId) throw new Error('Approver user is required');
  return {
    ...settlement,
    status: 'approved',
    approvedBy: approverUserId,
    approvedAt: now.toISOString()
  };
}

export function walletEntryFromSettlement(settlement, now = new Date()) {
  if (settlement.status !== 'approved') throw new Error('Settlement must be approved');
  return {
    idempotencyKey: `settlement:${settlement.id}`,
    technicianId: settlement.technicianId,
    settlementId: settlement.id,
    type: 'credit',
    amount: roundMoney(Number(settlement.payoutAmount)),
    currency: 'SAR',
    status: 'available',
    createdAt: now.toISOString()
  };
}

export function walletBalance(entries, technicianId) {
  const total = entries
    .filter(entry => entry.technicianId === technicianId && entry.status !== 'void')
    .reduce((sum, entry) => sum + (entry.type === 'debit' ? -Number(entry.amount) : Number(entry.amount)), 0);
  return roundMoney(total);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

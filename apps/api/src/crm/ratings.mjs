export function createServiceRating(input) {
  const score = Number(input.score);
  if (!input.jobId || !input.customerId || !input.technicianId) throw new Error('Rating must belong to a completed service');
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Rating score must be 1 to 5');
  return {
    jobId: input.jobId,
    customerId: input.customerId,
    technicianId: input.technicianId,
    score,
    comment: String(input.comment || '').trim().slice(0, 1000),
    verifiedService: true,
    createdAt: (input.createdAt ? new Date(input.createdAt) : new Date()).toISOString()
  };
}

export function technicianRating(ratings, technicianId) {
  const items = ratings.filter(r => r.technicianId === technicianId && r.verifiedService === true);
  if (!items.length) return { average: null, count: 0 };
  const average = items.reduce((sum, r) => sum + Number(r.score), 0) / items.length;
  return { average: Math.round(average * 100) / 100, count: items.length };
}

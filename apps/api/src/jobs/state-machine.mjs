const allowed = {
  pending_assignment: ['assigned', 'cancelled'],
  assigned: ['scheduled', 'pending_assignment', 'cancelled'],
  scheduled: ['en_route', 'assigned', 'cancelled'],
  en_route: ['arrived', 'scheduled'],
  arrived: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  cancelled: []
};

export function canTransition(from, to) {
  return Array.isArray(allowed[from]) && allowed[from].includes(to);
}

export function transitionJob(job, to, now = new Date()) {
  if (!canTransition(job.status, to)) {
    throw new Error(`Invalid transition: ${job.status} -> ${to}`);
  }

  const next = { ...job, status: to, updatedAt: now.toISOString() };
  if (to === 'completed') next.completedAt = now.toISOString();
  return next;
}

export function technicianJobView(job) {
  const {
    customerPhone,
    customerMobile,
    billingPhone,
    shippingPhone,
    ...safe
  } = job;
  return safe;
}

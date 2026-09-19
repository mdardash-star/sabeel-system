export function eligibleTechnicians(job, technicians) {
  return technicians.filter(t =>
    t.isActive === true &&
    t.cityId === job.cityId &&
    (!job.branchId || !t.branchId || t.branchId === job.branchId)
  );
}

export function rankTechnicians(job, technicians) {
  return eligibleTechnicians(job, technicians)
    .map(t => ({
      ...t,
      score: Number(t.rating || 0) * 10 - Number(t.jobsToday || 0) * 3 - Number(t.distanceKm || 0)
    }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

export function suggestTechnician(job, technicians) {
  return rankTechnicians(job, technicians)[0] || null;
}

export function assignJob(job, technician, scheduledAt) {
  if (!technician?.isActive) throw new Error('Technician must be active');
  if (technician.cityId !== job.cityId) throw new Error('Technician must serve the same city');
  if (!scheduledAt) throw new Error('Scheduled time is required');
  return {
    ...job,
    technicianId: technician.id,
    status: 'scheduled',
    scheduledAt: new Date(scheduledAt).toISOString()
  };
}

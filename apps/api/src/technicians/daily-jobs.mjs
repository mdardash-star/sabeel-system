import { technicianJobView } from '../jobs/state-machine.mjs';

export function dailyJobsForTechnician(jobs, technicianId, day) {
  const target = day instanceof Date ? day : new Date(day);
  const key = target.toISOString().slice(0, 10);

  return jobs
    .filter(job => job.technicianId === technicianId)
    .filter(job => job.scheduledAt && new Date(job.scheduledAt).toISOString().slice(0, 10) === key)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .map(technicianJobView);
}

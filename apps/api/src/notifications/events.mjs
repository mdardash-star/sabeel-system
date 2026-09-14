const eventByStatus = {
  scheduled: 'service.scheduled',
  en_route: 'technician.en_route',
  arrived: 'technician.arrived',
  completed: 'service.completed'
};

export function notificationForJobStatus(job, status) {
  const type = eventByStatus[status];
  if (!type) return null;
  return {
    type,
    customerId: job.customerId,
    jobId: job.id,
    channels: ['whatsapp', 'sms'],
    data: {
      scheduledAt: job.scheduledAt || null,
      ratingRequested: status === 'completed'
    },
    deliveryStatus: 'pending'
  };
}

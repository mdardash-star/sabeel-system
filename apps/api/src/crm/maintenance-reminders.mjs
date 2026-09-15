import { maintenanceDue } from './assets.mjs';

export function maintenanceReminderEvents(assets, now = new Date()) {
  return (assets || [])
    .filter(asset => maintenanceDue(asset, now))
    .map(asset => ({
      type: 'maintenance.due',
      customerId: asset.customerId,
      assetId: asset.id,
      productId: asset.productId,
      dueAt: asset.nextMaintenanceAt,
      channels: ['whatsapp', 'sms'],
      status: 'pending',
      createdAt: now.toISOString()
    }));
}

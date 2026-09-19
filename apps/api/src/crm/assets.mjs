export function registerInstalledAsset(input) {
  if (!input.customerId || !input.productId || !input.installedAt) throw new Error('Missing installed asset data');
  const installedAt = new Date(input.installedAt);
  const intervalMonths = Number(input.maintenanceIntervalMonths || 6);
  const nextMaintenanceAt = addMonths(installedAt, intervalMonths);
  return {
    id: input.id,
    customerId: input.customerId,
    productId: input.productId,
    serialNumber: input.serialNumber || null,
    installedAt: installedAt.toISOString(),
    warrantyEndsAt: input.warrantyEndsAt ? new Date(input.warrantyEndsAt).toISOString() : null,
    maintenanceIntervalMonths: intervalMonths,
    nextMaintenanceAt: nextMaintenanceAt.toISOString(),
    status: 'active'
  };
}

export function completeMaintenance(asset, completedAt = new Date()) {
  const at = new Date(completedAt);
  return {
    ...asset,
    lastMaintenanceAt: at.toISOString(),
    nextMaintenanceAt: addMonths(at, asset.maintenanceIntervalMonths || 6).toISOString()
  };
}

export function maintenanceDue(asset, now = new Date()) {
  return asset.status === 'active' && new Date(asset.nextMaintenanceAt) <= new Date(now);
}

function addMonths(date, months) {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

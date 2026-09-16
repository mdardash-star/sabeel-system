const permissions = {
  customer: ['customer:self:read'],
  technician: ['jobs:assigned:read', 'jobs:assigned:update', 'evidence:create'],
  dispatcher: ['jobs:read', 'jobs:assign', 'jobs:schedule', 'customers:service-view', 'technicians:read', 'inventory:read', 'ai:read', 'ai:dispatch'],
  support: ['customers:read', 'customers:create', 'customers:update', 'orders:read', 'jobs:read', 'marketing:read', 'conversations:read', 'conversations:update', 'ai:read', 'ai:suggest'],
  finance: ['settlements:read', 'settlements:approve', 'reports:finance', 'inventory:read', 'purchasing:read'],
  branch_manager: ['jobs:read', 'jobs:assign', 'jobs:schedule', 'customers:read', 'customers:create', 'customers:update', 'settlements:read', 'reports:finance', 'technicians:read', 'technicians:update', 'inventory:read', 'inventory:update', 'purchasing:read', 'purchasing:update', 'marketing:read', 'marketing:update', 'conversations:read', 'conversations:update', 'ai:read', 'ai:suggest', 'ai:approve', 'ai:manage', 'ai:dispatch'],
  admin: ['*'],
  super_admin: ['*']
};

export function can(role, permission) {
  const list = permissions[role] || [];
  return list.includes('*') || list.includes(permission);
}

export function requirePermission(role, permission) {
  if (!can(role, permission)) {
    throw new Error(`Forbidden: ${role} lacks ${permission}`);
  }
  return true;
}

export function permissionsFor(role) {
  return [...(permissions[role] || [])];
}

const permissions = {
  customer: ['customer:self:read'],
  technician: ['jobs:assigned:read', 'jobs:assigned:update', 'evidence:create'],
  dispatcher: ['jobs:read', 'jobs:assign', 'jobs:schedule', 'customers:service-view'],
  support: ['customers:read', 'customers:create', 'customers:update', 'orders:read', 'jobs:read'],
  finance: ['settlements:read', 'settlements:approve', 'reports:finance'],
  branch_manager: ['jobs:read', 'jobs:assign', 'jobs:schedule', 'customers:read', 'customers:create', 'customers:update', 'settlements:read'],
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

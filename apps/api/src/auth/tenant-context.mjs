const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function tenantContext(session){
  const tenantId=String(session?.organization_id||'').trim();
  if(!UUID_PATTERN.test(tenantId))throw new Error('Tenant context unavailable');
  return{tenantId};
}

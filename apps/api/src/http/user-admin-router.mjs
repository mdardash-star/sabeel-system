const STAFF_ROLES = ['dispatcher','support','finance','branch_manager','admin'];
const ALL_MANAGEABLE_ROLES = [...STAFF_ROLES, 'super_admin'];

export async function routeUserAdminRequest({ method, url, role, body = {}, context = {}, db }) {
  if (!url.startsWith('/api/v1/users')) return null;
  if (!['admin','super_admin'].includes(role)) return response(403,{error:'forbidden'});
  if (!context.userId || !context.tenantId) return response(401,{error:'user_identity_required'});

  if (method === 'GET' && url === '/api/v1/users/roles') {
    return response(200,{roles: role === 'super_admin' ? ALL_MANAGEABLE_ROLES : STAFF_ROLES});
  }

  if (method === 'GET' && url === '/api/v1/users') {
    const limit = numberParam(context.limit,20,1,100), offset = numberParam(context.offset,0,0,100000);
    if (limit === null || offset === null) return response(400,{error:'invalid_pagination'});
    const query = clean(context.query,100), status = clean(context.status,20) || 'all', roleFilter = clean(context.type,30) || 'all';
    if (!['all','active','inactive'].includes(status)) return response(400,{error:'invalid_user_status'});
    if (roleFilter !== 'all' && !ALL_MANAGEABLE_ROLES.includes(roleFilter)) return response(400,{error:'invalid_user_role'});
    const params = [context.tenantId, query, status, roleFilter, limit, offset, role === 'super_admin'];
    const {rows} = await db.query(`SELECT id,mobile,role,is_active,created_at,updated_at,COUNT(*) OVER()::integer AS total_count
      FROM users WHERE organization_id=$1
        AND ($7::boolean OR role<>'super_admin')
        AND ($2='' OR mobile ILIKE '%'||$2||'%')
        AND CASE $3 WHEN 'active' THEN is_active WHEN 'inactive' THEN NOT is_active ELSE true END
        AND ($4='all' OR role=$4)
      ORDER BY is_active DESC,created_at DESC LIMIT $5 OFFSET $6`,params);
    return response(200,{users:rows.map(({total_count,...x})=>x),pagination:{limit,offset,total:rows[0]?.total_count||0},status,role:roleFilter});
  }

  if (method === 'POST' && url === '/api/v1/users') {
    const mobile = normalizeSaudiMobile(body.mobile), nextRole = clean(body.role,30);
    if (!mobile || !allowedRole(role,nextRole)) return response(400,{error:'invalid_user'});
    try {
      const {rows:[user]} = await db.query(`INSERT INTO users(mobile,role,organization_id) VALUES($1,$2,$3)
        RETURNING id,mobile,role,is_active,created_at,updated_at`,[mobile,nextRole,context.tenantId]);
      await audit(db,context.userId,'user.created',user.id,{role:nextRole,mobile});
      return response(201,{user});
    } catch (error) {
      if (error.code === '23505') return response(409,{error:'mobile_already_exists'});
      throw error;
    }
  }

  const match = url.match(/^\/api\/v1\/users\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    const targetId = match[1], hasRole = Object.prototype.hasOwnProperty.call(body,'role'), hasActive = Object.prototype.hasOwnProperty.call(body,'isActive');
    if (!hasRole && !hasActive) return response(400,{error:'no_user_changes'});
    if (hasRole && !allowedRole(role,clean(body.role,30))) return response(400,{error:'invalid_user_role'});
    if (hasActive && typeof body.isActive !== 'boolean') return response(400,{error:'invalid_user_status'});
    if (targetId === context.userId && (hasRole || body.isActive === false)) return response(409,{error:'cannot_modify_own_access'});

    const {rows:[current]} = await db.query(`SELECT id,mobile,role,is_active FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1`,[targetId,context.tenantId]);
    if (!current) return response(404,{error:'user_not_found'});
    if (current.role === 'super_admin' && role !== 'super_admin') return response(403,{error:'forbidden'});

    const nextRole = hasRole ? clean(body.role,30) : current.role;
    const nextActive = hasActive ? body.isActive : current.is_active;
    const {rows:[user]} = await db.query(`UPDATE users SET role=$2,is_active=$3,updated_at=now() WHERE id=$1 AND organization_id=$4
      RETURNING id,mobile,role,is_active,created_at,updated_at`,[targetId,nextRole,nextActive,context.tenantId]);
    if (nextRole !== current.role || nextActive !== current.is_active) {
      await db.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL`,[targetId]);
    }
    await audit(db,context.userId,'user.access_updated',targetId,{from:{role:current.role,isActive:current.is_active},to:{role:nextRole,isActive:nextActive}});
    return response(200,{user});
  }

  return response(404,{error:'not_found'});
}

function allowedRole(actorRole,targetRole){return actorRole==='super_admin'?ALL_MANAGEABLE_ROLES.includes(targetRole):STAFF_ROLES.includes(targetRole)}
function clean(value,max){return typeof value==='string'?value.trim().slice(0,max):''}
function numberParam(value,fallback,min,max){const n=value===undefined?fallback:Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null}
function normalizeSaudiMobile(value){if(typeof value!=='string')return null;const d=value.replace(/\D/g,'');if(/^05\d{8}$/.test(d))return`+966${d.slice(1)}`;if(/^5\d{8}$/.test(d))return`+966${d}`;if(/^9665\d{8}$/.test(d))return`+${d}`;return null}
async function audit(db,actorUserId,action,entityId,data){await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data) VALUES($1,$2,'user',$3,$4::jsonb)`,[actorUserId,action,entityId,JSON.stringify(data)])}
function response(status,data){return{status,data}}

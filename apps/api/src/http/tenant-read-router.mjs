import { can } from '../auth/rbac.mjs';
import { createTenantReadRepositories } from '../persistence/tenant-read-repositories.mjs';

export async function routeTenantReadRequest({ method, url, role, context = {}, db }) {
  if (method !== 'GET' || !context.tenantId) return null;
  const repos = createTenantReadRepositories(db, context.tenantId);
  const pagination = parsePagination(context);

  if (url === '/api/v1/inventory/stats') {
    if (!can(role,'inventory:read')) return response(403,{error:'forbidden'});
    return response(200,{stats:await repos.inventory.stats()});
  }
  if (url === '/api/v1/inventory') {
    if (!can(role,'inventory:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const status=context.status||'all'; if(!['all','low','out'].includes(status))return response(400,{error:'invalid_inventory_status_filter'});
    const rows=await repos.inventory.list({...pagination,status,query:context.query||''});
    return response(200,{items:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status});
  }
  if (url === '/api/v1/inventory/movements') {
    if (!can(role,'inventory:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const rows=await repos.inventory.movements(pagination);
    return response(200,{movements:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}});
  }
  const techInventory=url.match(/^\/api\/v1\/technicians\/([^/]+)\/inventory$/);
  if (techInventory) {
    if (!can(role,'inventory:read')) return response(403,{error:'forbidden'});
    return response(200,{technicianId:techInventory[1],stock:await repos.inventory.technicianStock(techInventory[1])});
  }

  if (url === '/api/v1/purchasing/stats') {
    if (!can(role,'purchasing:read')) return response(403,{error:'forbidden'});
    return response(200,{stats:await repos.purchasing.stats()});
  }
  if (url === '/api/v1/purchasing/suppliers') {
    if (!can(role,'purchasing:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const rows=await repos.purchasing.suppliers({...pagination,query:context.query||''});
    return response(200,{suppliers:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}});
  }
  if (url === '/api/v1/purchasing/orders') {
    if (!can(role,'purchasing:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const status=context.status||'all'; if(!['all','draft','approved','partially_received','received','cancelled','overdue'].includes(status))return response(400,{error:'invalid_purchase_order_status'});
    const rows=await repos.purchasing.list({...pagination,status,query:context.query||''});
    return response(200,{orders:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status});
  }

  if (url === '/api/v1/marketing/stats') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    return response(200,{stats:await repos.marketing.stats()});
  }
  if (url === '/api/v1/marketing/segments') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    return response(200,{segments:await repos.marketing.segments()});
  }
  if (url === '/api/v1/marketing/campaigns') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const status=context.status||'all'; if(!['all','draft','scheduled','queued','completed','cancelled'].includes(status))return response(400,{error:'invalid_campaign_status'});
    const rows=await repos.marketing.campaigns({...pagination,status});
    return response(200,{campaigns:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status});
  }
  if (url === '/api/v1/conversations/stats') {
    if (!can(role,'conversations:read')) return response(403,{error:'forbidden'});
    return response(200,{stats:await repos.marketing.conversationStats()});
  }
  if (url === '/api/v1/conversations') {
    if (!can(role,'conversations:read')) return response(403,{error:'forbidden'});
    if (!pagination) return response(400,{error:'invalid_pagination'});
    const status=context.status||'active',channel=context.channel||'all';
    if(!['all','active','open','pending_agent','waiting_customer','closed'].includes(status)||!['all','whatsapp','email','instagram','x','sms','webchat'].includes(channel))return response(400,{error:'invalid_conversation_filter'});
    const rows=await repos.marketing.conversations({...pagination,status,channel,query:context.query||''});
    return response(200,{conversations:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,channel});
  }
  const conversation=url.match(/^\/api\/v1\/conversations\/([^/]+)$/);
  if (conversation) {
    if (!can(role,'conversations:read')) return response(403,{error:'forbidden'});
    const thread=await repos.marketing.conversationThread(conversation[1]);
    return thread?response(200,thread):response(404,{error:'conversation_not_found'});
  }

  if (url === '/api/v1/ai/stats') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.stats()}); }
  if (url === '/api/v1/ai/suggestions') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'all'; if(!['all','draft','approved','rejected','used'].includes(status))return response(400,{error:'invalid_ai_suggestion_status'}); const rows=await repos.ai.suggestions({...pagination,status}); return response(200,{suggestions:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status}); }
  if (url === '/api/v1/ai/knowledge') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'approved'; if(!['all','draft','approved','archived'].includes(status))return response(400,{error:'invalid_knowledge_status'}); const rows=await repos.ai.knowledge({...pagination,status}); return response(200,{articles:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status}); }
  if (url === '/api/v1/ai/insights/stats') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.insightStats()}); }
  if (url === '/api/v1/ai/insights') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'open',domain=context.domain||'all'; if(!['all','open','acknowledged','resolved','dismissed'].includes(status)||!['all','operations','finance','inventory','marketing','customer_care'].includes(domain))return response(400,{error:'invalid_insight_filter'}); const rows=await repos.ai.insights({...pagination,status,domain}); return response(200,{insights:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,domain}); }
  if (url === '/api/v1/ai/brief') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{brief:await repos.ai.latestBrief()}); }
  if (url === '/api/v1/ai/dispatch/stats') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.dispatchStats()}); }
  if (url === '/api/v1/ai/dispatch/queue') { if(!can(role,'ai:dispatch'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const rows=await repos.ai.dispatchQueue(pagination); return response(200,{jobs:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}}); }
  if (url === '/api/v1/ai/dispatch/recommendations') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'all'; if(!['all','pending','approved','rejected','expired'].includes(status))return response(400,{error:'invalid_dispatch_recommendation_status'}); const rows=await repos.ai.dispatchRecommendations({...pagination,status}); return response(200,{recommendations:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status}); }
  if (url === '/api/v1/ai/sales/stats') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.salesStats()}); }
  if (url === '/api/v1/ai/sales/opportunities') { if(!can(role,'ai:sales'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'active',type=context.type||'all'; if(!['all','active','new','approved','contacted','converted','dismissed','lost'].includes(status)||!['all','maintenance_due','cart_recovery','cross_sell','win_back','conversation_followup'].includes(type))return response(400,{error:'invalid_sales_opportunity_filter'}); const rows=await repos.ai.salesOpportunities({...pagination,status,type}); return response(200,{opportunities:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,type}); }
  if (url === '/api/v1/ai/marketing/stats') { if(!can(role,'ai:read'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.marketingStats()}); }
  if (url === '/api/v1/ai/marketing/recommendations') { if(!can(role,'marketing:read'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'active',type=context.type||'all'; if(!['all','active','new','approved','scheduled','completed','dismissed'].includes(status)||!['all','recovery_campaign','budget_shift','content_plan','attribution_fix','delivery_fix'].includes(type))return response(400,{error:'invalid_marketing_recommendation_filter'}); const rows=await repos.ai.marketingRecommendations({...pagination,status,type}); return response(200,{recommendations:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,type}); }
  if (url === '/api/v1/ai/finance/stats') { if(!can(role,'ai:finance'))return response(403,{error:'forbidden'}); return response(200,{stats:await repos.ai.financeStats()}); }
  if (url === '/api/v1/ai/finance/anomalies') { if(!can(role,'ai:finance'))return response(403,{error:'forbidden'}); if(!pagination)return response(400,{error:'invalid_pagination'}); const status=context.status||'active',type=context.type||'all'; if(!['all','active','open','reviewed','resolved','dismissed'].includes(status)||!['all','negative_margin','revenue_drop','settlement_backlog','overdue_purchase'].includes(type))return response(400,{error:'invalid_finance_anomaly_filter'}); const rows=await repos.ai.financeAnomalies({...pagination,status,type}); return response(200,{anomalies:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,type}); }

  return null;
}

function parsePagination(context){const limit=context.limit===undefined?20:Number(context.limit),offset=context.offset===undefined?0:Number(context.offset);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)return null;return{limit,offset};}
function response(status,data){return{status,data};}

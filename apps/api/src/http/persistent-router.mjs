import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';
import { approveSettlementAndCreditWallet, completeAssetMaintenance, completeTechnicianJob, markSettlementPaid, rejectSettlement, setTechnicianActive, transitionTechnicianJob, updateAssetStatus } from '../persistence/transactions.mjs';
import { assignPersistentJob, listDispatchCandidates, reassignPersistentJob } from '../dispatch/persistent-dispatch.mjs';
import { detectJobEscalations, resolveJobEscalations } from '../jobs/escalations.mjs';
import { createInventoryItem, issueInventoryToTechnician, receiveInventory, transferInventory } from '../inventory/operations.mjs';
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder } from '../purchasing/operations.mjs';
import { createCampaign, createSegment, launchCampaign, previewAudience } from '../marketing/operations.mjs';
import { markCartRecovered, runAbandonedCartRecovery, upsertAbandonedCart } from '../marketing/abandoned-carts.mjs';
import { createContent, transitionContent, publishContentExternally } from '../marketing/content.mjs';
import { attributeOrder, recordSpend, recordTouch } from '../marketing/attribution.mjs';
import { ingestConversationMessage, replyToConversation, updateConversation } from '../marketing/conversations.mjs';
import { createCareSuggestion, createKnowledgeArticle, reviewSuggestion, useSuggestion } from '../ai/copilot.mjs';
import { generateExecutiveInsights, updateInsight } from '../ai/insights.mjs';
import { createDispatchRecommendation, reviewDispatchRecommendation } from '../ai/dispatch.mjs';
import { scanSalesOpportunities, updateSalesOpportunity } from '../ai/sales.mjs';
import { scanMarketingRecommendations, updateMarketingRecommendation } from '../ai/marketing.mjs';
import { scanFinanceAnomalies, updateFinanceAnomaly } from '../ai/finance.mjs';
import { scanMarketingAlerts } from '../ai/marketing-alerts.mjs';
import { rateCustomerJob } from '../crm/customer-portal.mjs';
import { createWooCommerceCatalogClient } from '../integrations/woocommerce-catalog.mjs';
import { createMarketingChannelSender } from '../integrations/marketing-channel-sender.mjs';
import { createWordPressPublisher } from '../integrations/wordpress-publisher.mjs';
import { createSubilCommerceAnalyticsClient } from '../integrations/subil-commerce-analytics.mjs';
import { disablePushSubscription, getNotificationSettings, savePushSubscription, updateNotificationSettings } from '../notifications/push.mjs';

export async function routePersistentRequest({ method, url, role, body = {}, context = {}, db }) {
  if (!db?.query) return response(503, { error: 'database_unavailable' });

  if(method==='GET'&&url==='/api/v1/notifications/me'){if(!context.userId||!['customer','technician'].includes(role))return response(403,{error:'forbidden'});return response(200,await getNotificationSettings(db,context.userId));}
  if(method==='GET'&&url==='/api/v1/notifications/config'){if(!context.userId||!['customer','technician'].includes(role))return response(403,{error:'forbidden'});const publicKey=String(process.env.PUSH_VAPID_PUBLIC_KEY||'').trim();return response(200,{enabled:Boolean(publicKey),publicKey:publicKey||null});}
  if(method==='POST'&&url==='/api/v1/notifications/subscriptions'){if(!context.userId||!['customer','technician'].includes(role))return response(403,{error:'forbidden'});const endpoint=cleanLongText(body.endpoint,2000),p256dh=cleanLongText(body.keys?.p256dh,500),auth=cleanLongText(body.keys?.auth,500);if(!endpoint.startsWith('https://')||!p256dh||!auth)return response(400,{error:'invalid_push_subscription'});return response(201,{subscription:await savePushSubscription(db,{userId:context.userId,endpoint,p256dh,auth,userAgent:cleanLongText(body.userAgent,500)})});}
  if(method==='POST'&&url==='/api/v1/notifications/subscriptions/disable'){if(!context.userId||!['customer','technician'].includes(role))return response(403,{error:'forbidden'});const endpoint=cleanLongText(body.endpoint,2000);if(!endpoint)return response(400,{error:'endpoint_required'});const subscription=await disablePushSubscription(db,{userId:context.userId,endpoint});return subscription?response(200,{subscription}):response(404,{error:'subscription_not_found'});}
  if(method==='PATCH'&&url==='/api/v1/notifications/me'){if(!context.userId||!['customer','technician'].includes(role))return response(403,{error:'forbidden'});if(typeof body.serviceUpdates!=='boolean'||typeof body.maintenanceReminders!=='boolean'||typeof body.marketing!=='boolean')return response(400,{error:'invalid_notification_preferences'});return response(200,{preferences:await updateNotificationSettings(db,{userId:context.userId,...body})});}

  if(method==='GET'&&url==='/api/v1/customers/me'){const identity=await resolveCustomer({role,context,db});if(identity.error)return identity.error;return response(200,{customer:identity.customer});}
  if(method==='GET'&&url==='/api/v1/customers/me/orders'){const identity=await resolveCustomer({role,context,db});if(identity.error)return identity.error;const pagination=parsePagination(context);if(!pagination)return response(400,{error:'invalid_pagination'});const rows=await identity.repos.customers.listOrders(identity.customer.id,pagination);return response(200,{orders:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}});}
  if(method==='GET'&&url==='/api/v1/customers/me/assets'){const identity=await resolveCustomer({role,context,db});if(identity.error)return identity.error;const pagination=parsePagination(context);if(!pagination)return response(400,{error:'invalid_pagination'});const rows=await identity.repos.customers.listAssets(identity.customer.id,pagination);return response(200,{assets:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}});}
  if(method==='GET'&&url==='/api/v1/customers/me/jobs'){const identity=await resolveCustomer({role,context,db});if(identity.error)return identity.error;const pagination=parsePagination(context);if(!pagination)return response(400,{error:'invalid_pagination'});const rows=await identity.repos.customers.listServiceJobs(identity.customer.id,pagination);return response(200,{jobs:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0}});}
  const customerRatingMatch=url.match(/^\/api\/v1\/customers\/me\/jobs\/([^/]+)\/rating$/);
  if(method==='POST'&&customerRatingMatch){const identity=await resolveCustomer({role,context,db});if(identity.error)return identity.error;const score=Number(body.score),comment=cleanLongText(body.comment,1000);if(!Number.isInteger(score)||score<1||score>5)return response(400,{error:'invalid_rating'});try{const rating=await rateCustomerJob(db,{jobId:customerRatingMatch[1],customerId:identity.customer.id,actorUserId:context.userId,score,comment});return rating?response(201,{rating}):response(404,{error:'job_not_found'});}catch(error){if(error.message==='Service not completed')return response(409,{error:'service_not_completed'});if(error.message==='Rating already exists')return response(409,{error:'rating_already_exists'});if(error.message==='Technician missing')return response(409,{error:'technician_missing'});throw error;}}

  if (method === 'GET' && url === '/api/v1/customers/stats') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).customers.stats(context.tenantId||null);
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/customers') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const rows = await repos.customers.list({ ...pagination, query: context.query || '',tenantId:context.tenantId||null });
    return response(200, {
      customers: rows.map(({ total_count, ...customer }) => customer),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }

  if (method === 'POST' && url === '/api/v1/customers') {
    if (!can(role, 'customers:create')) return response(403, { error: 'forbidden' });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mobile = normalizeSaudiMobile(body.mobile);
    if (name.length < 2 || !mobile) return response(400, { error: 'invalid_customer' });
    try {
      const customer = await createRepositories(db).customers.create({
        name,mobile,cityId:cleanOptional(body.cityId),addressText:cleanOptional(body.addressText),organizationId:context.tenantId||null
      });
      return response(201, { customer });
    } catch (error) {
      if (error.message === 'Customer mobile already exists') return response(409, { error: 'mobile_already_exists' });
      throw error;
    }
  }

  if (method === 'GET' && url === '/api/v1/maintenance/stats') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).assets.maintenanceStats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/maintenance/assets') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const window = context.window || 'all';
    if (!['all', 'overdue', '7d', '30d'].includes(window)) return response(400, { error: 'invalid_maintenance_window' });
    const rows = await createRepositories(db).assets.listMaintenance({
      ...pagination, window, query: context.query || ''
    });
    return response(200, {
      assets: rows.map(({ total_count, ...asset }) => asset),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 },
      window
    });
  }

  if (method === 'GET' && url === '/api/v1/jobs/stats') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).jobs.operationsStats(context.tenantId||null);
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/jobs') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all','open','pending_assignment','scheduled','active','overdue','completed','cancelled'].includes(status)) {
      return response(400, { error: 'invalid_job_status_filter' });
    }
    const rows = await createRepositories(db).jobs.listForOperations({
      ...pagination, status, query: context.query || '', tenantId: context.tenantId||null
    });
    return response(200, {
      jobs: rows.map(({ total_count, ...job }) => job),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 },
      status
    });
  }

  if (method === 'GET' && url === '/api/v1/jobs/escalations/stats') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).escalations.stats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/jobs/escalations') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'open';
    if (!['all', 'open', 'resolved'].includes(status)) return response(400, { error: 'invalid_escalation_status_filter' });
    const rows = await createRepositories(db).escalations.list({ ...pagination, status });
    return response(200, {
      escalations: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'POST' && url === '/api/v1/jobs/escalations/run') {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const limit = Number(body.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return response(400, { error: 'invalid_escalation_limit' });
    const result = await detectJobEscalations(db, { actorUserId: context.userId, limit });
    return response(200, result);
  }

  const escalationResolveMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/escalations\/resolve$/);
  if (method === 'POST' && escalationResolveMatch) {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const reason = cleanOptional(body.reason);
    if (reason.length < 3) return response(400, { error: 'resolution_reason_required' });
    const escalations = await resolveJobEscalations(db, { jobId: escalationResolveMatch[1], reason, actorUserId: context.userId });
    return escalations.length ? response(200, { escalations }) : response(404, { error: 'open_escalation_not_found' });
  }

  if (method === 'GET' && url === '/api/v1/technicians/stats') {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).technicians.operationsStats(context.tenantId||null);
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/technicians') {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'active', 'inactive'].includes(status)) return response(400, { error: 'invalid_technician_status_filter' });
    const rows = await createRepositories(db).technicians.listForOperations({
      ...pagination,status,query:context.query||'',tenantId:context.tenantId||null
    });
    return response(200, {
      technicians: rows.map(({ total_count, ...technician }) => technician),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/settlements/stats') {
    if (!can(role, 'settlements:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).settlements.operationsStats(context.tenantId||null);
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/reports/profitability') {
    if (!can(role, 'reports:finance')) return response(403, { error: 'forbidden' });
    const range = parseDateRange(context.from, context.to);
    if (!range) return response(400, { error: 'invalid_date_range' });
    const report = await createRepositories(db).reports.profitability(range.from, range.to, context.tenantId||null);
    return response(200, { ...report, range });
  }

  if (method === 'GET' && url === '/api/v1/marketing/wordpress/status') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const publisher=createWordPressPublisher();
    return response(200,{configured:publisher.configured,site:process.env.WORDPRESS_PUBLISH_URL||process.env.WOOCOMMERCE_BASE_URL||null});
  }

  if (method === 'GET' && url === '/api/v1/marketing/channels/status') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const sender=createMarketingChannelSender();
    return response(200,{channels:{
      push:{configured:Boolean(process.env.PUSH_PROVIDER_URL&&process.env.PUSH_PROVIDER_API_KEY)},
      whatsapp:{configured:sender.whatsappConfigured},
      email:{configured:sender.emailConfigured}
    }});
  }

  const publishContentMatch=url.match(/^\/api\/v1\/marketing\/content\/([^/]+)\/publish-wordpress$/);
  if (method === 'POST' && publishContentMatch) {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const publisher=createWordPressPublisher();
    if(!publisher.configured)return response(503,{error:'wordpress_publisher_not_configured'});
    try{
      const result=await publishContentExternally(db,{contentId:publishContentMatch[1],actorUserId:context.userId,publisher});
      return result?response(200,result):response(404,{error:'content_not_found'});
    }catch(error){
      if(error.message==='Content must be approved before publishing')return response(409,{error:'content_not_approved'});
      return response(502,{error:'wordpress_publish_failed'});
    }
  }

  const contentIdeaDraftMatch=url.match(/^\/api\/v1\/marketing\/store\/content-ideas\/([^/]+)\/draft$/);
  if (method === 'POST' && contentIdeaDraftMatch) {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{
      const product=await woo.getProduct(contentIdeaDraftMatch[1]);
      const keyword=product.name.split('–')[0].trim().slice(0,120);
      const title=cleanLongText(body.title,180)||`دليل ${product.name}`;
      const slug=String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,180);
      const metaDescription=`تعرف على ${product.name}، أهم الاستخدامات والمميزات وما الذي يجب معرفته قبل الشراء من سبيل.`.slice(0,160);
      const productUrl=`${String(process.env.WOOCOMMERCE_BASE_URL||'https://subil.store').replace(/\/$/,'')}/product/${product.slug}/?utm_source=organic_content&utm_medium=article&utm_campaign=subil_cmo&utm_content=${encodeURIComponent(slug)}`;
      const bodyHtml=`<h2>${title}</h2><p>هذا الدليل يساعدك على فهم ${product.name} واستخدامه المناسب قبل اتخاذ قرار الشراء.</p><h3>ما هو المنتج؟</h3><p>${product.shortDescription||'منتج من متجر سبيل ضمن حلول المياه المنزلية.'}</p><h3>متى يكون مناسبًا؟</h3><p>يعتمد الاختيار على احتياج المنزل أو المنشأة، مصدر المياه، ونوع الاستخدام. يفضل مراجعة المواصفات ونطاق التركيب قبل الشراء.</p><h3>ما الذي يجب الانتباه له؟</h3><ul><li>التأكد من توافق المنتج مع موقع التركيب.</li><li>مراجعة متطلبات الصيانة وقطع الغيار.</li><li>اختيار المنتج بناءً على الاستخدام الفعلي وليس الاسم فقط.</li></ul><h3>منتجات وخدمات سبيل</h3><p><a href="${productUrl}">عرض ${product.name} في متجر سبيل</a> للحصول على السعر والمواصفات الحالية وخيارات الطلب.</p>`;
      const item=await createContent(db,{title,slug,contentType:'article',channel:'website',body:bodyHtml,primaryKeyword:keyword,metaDescription,scheduledAt:null,actorUserId:context.userId});
      return response(201,{content:item,sourceProduct:product});
    }catch(error){return response(502,{error:'content_draft_creation_failed'});}
  }

  if (method === 'GET' && url === '/api/v1/marketing/store/commerce-analytics') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const analytics=createSubilCommerceAnalyticsClient();
    if(!analytics.configured)return response(503,{error:'commerce_analytics_not_configured'});
    try{return response(200,{analytics:await analytics.getAnalytics()});}
    catch(error){return response(502,{error:'commerce_analytics_unavailable'});}
  }

  if (method === 'GET' && url === '/api/v1/marketing/store/content-ideas') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{
      const intel=await woo.getStoreIntelligence();
      const opportunities=intel?.products?.seo?.opportunities||[];
      const ideas=opportunities.slice(0,12).map((x,index)=>({
        id:`seo-${x.id}`,
        priority:x.priority,
        productId:x.id,
        productName:x.name,
        title:index%3===0?`دليل اختيار ${x.name}`:index%3===1?`أسئلة شائعة عن ${x.name}`:`مقارنة واستخدامات ${x.name}`,
        angle:index%3===0?'دليل شراء واستخدام':index%3===1?'FAQ وتحسين التحويل':'مقارنة وتعليم العميل',
        suggestedChannel:index%2===0?'website':'email',
        sourceIssues:x.issues
      }));
      return response(200,{ideas});
    }catch(error){return response(502,{error:'woocommerce_unavailable'});}
  }

  if (method === 'GET' && url === '/api/v1/marketing/store/intelligence') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{return response(200,{connected:true,intelligence:await woo.getStoreIntelligence()});}
    catch(error){return response(502,{error:'woocommerce_unavailable'});}
  }
  if (method === 'GET' && url === '/api/v1/marketing/store/orders') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{return response(200,{orders:await woo.listOrders({page:Number(context.page||1),perPage:Math.min(Number(context.perPage||50),100),status:context.status||'any',after:context.after||''})});}
    catch(error){return response(502,{error:'woocommerce_unavailable'});}
  }
  if (method === 'GET' && url === '/api/v1/marketing/store/customers') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{return response(200,{customers:await woo.listCustomers({page:Number(context.page||1),perPage:Math.min(Number(context.perPage||50),100)})});}
    catch(error){return response(502,{error:'woocommerce_unavailable'});}
  }

  if (method === 'GET' && url === '/api/v1/marketing/store/products') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{
      const products=await woo.listProducts({page:Number(context.page||1),perPage:Math.min(Number(context.perPage||24),50),search:context.search||'',category:context.category||''});
      return response(200,{connected:true,products});
    }catch(error){return response(502,{error:'woocommerce_unavailable'});}
  }
  const marketingStoreSeoMatch=url.match(/^\/api\/v1\/marketing\/store\/products\/([^/]+)\/seo\/apply$/);
  if (method === 'POST' && marketingStoreSeoMatch) {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{
      const result=await woo.applySafeSeoPatch(marketingStoreSeoMatch[1]);
      return response(200,result);
    }catch(error){return response(502,{error:'woocommerce_seo_apply_failed'});}
  }
  const marketingStoreProductMatch=url.match(/^\/api\/v1\/marketing\/store\/products\/([^/]+)$/);
  if (method === 'PATCH' && marketingStoreProductMatch) {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    if(!woo.configured)return response(503,{error:'woocommerce_not_configured'});
    try{
      const product=await woo.updateProduct(marketingStoreProductMatch[1],{
        name:typeof body.name==='string'?body.name:undefined,
        shortDescription:typeof body.shortDescription==='string'?body.shortDescription:undefined,
        description:typeof body.description==='string'?body.description:undefined
      });
      return response(200,{product});
    }catch(error){
      if(error.message==='No safe product fields supplied')return response(400,{error:'no_safe_fields'});
      return response(502,{error:'woocommerce_update_failed'});
    }
  }

  if (method === 'GET' && url === '/api/v1/marketing/stats') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    return response(200,{stats:await createRepositories(db).marketing.stats()});
  }
  if (method === 'GET' && url === '/api/v1/marketing/segments') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    return response(200,{segments:await createRepositories(db).marketing.segments()});
  }
  if (method === 'GET' && url === '/api/v1/marketing/campaigns') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const pagination=parsePagination(context),status=context.status||'all';
    if(!pagination)return response(400,{error:'invalid_pagination'});
    if(!['all','draft','scheduled','queued','completed','cancelled'].includes(status))return response(400,{error:'invalid_campaign_status'});
    const rows=await createRepositories(db).marketing.campaigns({...pagination,status});
    return response(200,{campaigns:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status});
  }
  if (method === 'GET' && url === '/api/v1/marketing/audience-preview') {
    if (!can(role,'marketing:read')) return response(403,{error:'forbidden'});
    const segmentType=context.segmentType||'all';
    if(!validSegmentType(segmentType))return response(400,{error:'invalid_segment_type'});
    return response(200,await previewAudience(db,segmentType,10));
  }
  if (method === 'POST' && url === '/api/v1/marketing/segments') {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});
    const name=cleanOptional(body.name),segmentType=cleanOptional(body.segmentType);
    if(name.length<2||name.length>120||!validSegmentType(segmentType))return response(400,{error:'invalid_segment'});
    try{return response(201,{segment:await createSegment(db,{name,segmentType,actorUserId:context.userId})});}catch(error){if(error.code==='23505')return response(409,{error:'segment_exists'});throw error;}
  }
  if (method === 'POST' && url === '/api/v1/marketing/campaigns') {
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});
    const name=cleanOptional(body.name),segmentId=cleanOptional(body.segmentId),channel=cleanOptional(body.channel),message=cleanOptional(body.message),scheduledAt=body.scheduledAt?parseDate(body.scheduledAt):null;
    if(name.length<2||name.length>160||!segmentId||!['whatsapp','sms','email'].includes(channel)||message.length<3||message.length>1500||(body.scheduledAt&&!scheduledAt))return response(400,{error:'invalid_campaign'});
    try{return response(201,{campaign:await createCampaign(db,{name,segmentId,channel,message,scheduledAt,actorUserId:context.userId})});}catch(error){if(error.message.includes('not found'))return response(404,{error:'segment_not_found'});throw error;}
  }
  const campaignLaunchMatch=url.match(/^\/api\/v1\/marketing\/campaigns\/([^/]+)\/launch$/);
  if(method==='POST'&&campaignLaunchMatch){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});try{const result=await launchCampaign(db,{campaignId:campaignLaunchMatch[1],actorUserId:context.userId});return result?response(200,result):response(404,{error:'campaign_not_found'});}catch(error){if(error.message.includes('not launchable'))return response(409,{error:'campaign_not_launchable'});throw error;}}

  if(method==='GET'&&url==='/api/v1/marketing/abandoned-carts/stats'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).marketing.abandonedStats()});}
  if(method==='GET'&&url==='/api/v1/marketing/abandoned-carts'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'active';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','active','open','notified','recovered','expired','cancelled'].includes(status))return response(400,{error:'invalid_abandoned_cart_status'});const rows=await createRepositories(db).marketing.abandonedCarts({...pagination,status});return response(200,{carts:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status});}
  if(method==='POST'&&url==='/api/v1/marketing/abandoned-carts'){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const externalCartId=cleanOptional(body.externalCartId),customerName=cleanOptional(body.customerName),mobile=cleanOptional(body.mobile),email=cleanOptional(body.email),checkoutUrl=cleanOptional(body.checkoutUrl),currency=(cleanOptional(body.currency)||'SAR').toUpperCase(),cartValue=Number(body.cartValue),abandonedAt=parseDate(body.abandonedAt),items=Array.isArray(body.items)?body.items:[];if(!externalCartId||externalCartId.length>200||(!mobile&&!email)||mobile.length>30||email.length>200||checkoutUrl.length>2000||currency.length!==3||!validInventoryNumber(cartValue,true)||!abandonedAt||items.length>100)return response(400,{error:'invalid_abandoned_cart'});try{return response(201,{cart:await upsertAbandonedCart(db,{externalSource:cleanOptional(body.externalSource)||'woocommerce',externalCartId,customerId:cleanOptional(body.customerId),customerName,mobile,email,checkoutUrl,currency,cartValue,abandonedAt,items,actorUserId:context.userId})});}catch(error){if(error.message.includes('closed'))return response(409,{error:'abandoned_cart_closed'});throw error;}}
  if(method==='POST'&&url==='/api/v1/marketing/abandoned-carts/recovery/run'){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const limit=Number(body.limit??100);if(!Number.isInteger(limit)||limit<1||limit>500)return response(400,{error:'invalid_recovery_limit'});return response(200,await runAbandonedCartRecovery(db,{actorUserId:context.userId,limit}));}
  const cartRecoveredMatch=url.match(/^\/api\/v1\/marketing\/abandoned-carts\/([^/]+)\/recovered$/);if(method==='POST'&&cartRecoveredMatch){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const cart=await markCartRecovered(db,{cartId:cartRecoveredMatch[1],orderId:cleanOptional(body.orderId),actorUserId:context.userId});return cart?response(200,{cart}):response(404,{error:'active_abandoned_cart_not_found'});}

  if(method==='GET'&&url==='/api/v1/marketing/content/performance'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT mc.id,mc.title,mc.slug,mc.status,mc.seo_score,mc.published_at,
      COUNT(DISTINCT mt.id)::integer AS touches,
      COUNT(DISTINCT oa.order_id)::integer AS attributed_orders,
      COALESCE(SUM(DISTINCT CASE WHEN oa.order_id IS NOT NULL THEN o.total_ex_vat ELSE 0 END),0)::numeric(14,2) AS attributed_revenue,
      (SELECT al.data->>'link' FROM audit_log al WHERE al.entity_type='marketing_content' AND al.entity_id=mc.id::text AND al.action='marketing.content_published_wordpress' ORDER BY al.created_at DESC LIMIT 1) AS wordpress_url
      FROM marketing_content mc
      LEFT JOIN marketing_touches mt ON mt.content=mc.slug
      LEFT JOIN order_attribution oa ON oa.first_touch_id=mt.id OR oa.last_touch_id=mt.id
      LEFT JOIN orders o ON o.id=oa.order_id
      GROUP BY mc.id
      ORDER BY COALESCE(mc.published_at,mc.updated_at,mc.created_at) DESC
      LIMIT 50`)).rows;
    return response(200,{content:rows});
  }

  if(method==='GET'&&url==='/api/v1/marketing/content/stats'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).marketing.contentStats()});}
  if(method==='GET'&&url==='/api/v1/marketing/content'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'all',channel=context.channel||'all',from=context.from?parseDate(context.from):null,to=context.to?parseDate(context.to):null;if(!pagination)return response(400,{error:'invalid_pagination'});if(!validContentStatus(status)||!validContentChannel(channel)||(context.from&&!from)||(context.to&&!to)||(from&&to&&from>=to))return response(400,{error:'invalid_content_filter'});const rows=await createRepositories(db).marketing.content({...pagination,status,channel,from,to});return response(200,{content:rows.map(({total_count,...x})=>x),pagination:{...pagination,total:rows[0]?.total_count||0},status,channel});}
  if(method==='POST'&&url==='/api/v1/marketing/content'){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const title=cleanOptional(body.title),slug=cleanOptional(body.slug).toLowerCase(),contentType=cleanOptional(body.contentType),channel=cleanOptional(body.channel),contentBody=cleanOptional(body.body),primaryKeyword=cleanOptional(body.primaryKeyword),metaDescription=cleanOptional(body.metaDescription),scheduledAt=body.scheduledAt?parseDate(body.scheduledAt):null;if(title.length<3||title.length>200||!slug||slug.length>200||!/^[-a-z0-9\u0600-\u06ff]+$/.test(slug)||!['social','blog','email','landing_page'].includes(contentType)||!validContentChannel(channel,false)||contentBody.length>50000||primaryKeyword.length>120||metaDescription.length>200||(body.scheduledAt&&!scheduledAt))return response(400,{error:'invalid_marketing_content'});try{return response(201,{content:await createContent(db,{title,slug,contentType,channel,body:contentBody,primaryKeyword,metaDescription,scheduledAt,actorUserId:context.userId})});}catch(error){if(error.code==='23505')return response(409,{error:'content_slug_exists'});throw error;}}
  const contentTransitionMatch=url.match(/^\/api\/v1\/marketing\/content\/([^/]+)\/transition$/);if(method==='POST'&&contentTransitionMatch){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const to=cleanOptional(body.to),scheduledAt=body.scheduledAt?parseDate(body.scheduledAt):null;if(!validContentStatus(to,false)||(body.scheduledAt&&!scheduledAt))return response(400,{error:'invalid_content_transition'});try{const content=await transitionContent(db,{contentId:contentTransitionMatch[1],to,scheduledAt,actorUserId:context.userId});return content?response(200,{content}):response(404,{error:'marketing_content_not_found'});}catch(error){if(error.message.includes('Invalid content transition')||error.message.includes('Schedule time required'))return response(409,{error:'content_transition_conflict',message:error.message});throw error;}}

  if(method==='GET'&&url==='/api/v1/marketing/executive-brief-live'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient(),commerce=createSubilCommerceAnalyticsClient();
    let store=null,commerceData=null;
    if(woo.configured){try{store=await woo.getStoreIntelligence()}catch{}}
    if(commerce.configured){try{commerceData=await commerce.getAnalytics()}catch{}}
    const revenueRows=(await db.query(`SELECT COUNT(*)::integer AS orders,COALESCE(SUM(total_ex_vat),0)::numeric(14,2) AS revenue,
      COALESCE(AVG(total_ex_vat),0)::numeric(14,2) AS aov FROM orders WHERE paid_at>=now()-interval '90 days'`)).rows[0]||{};
    const channelRows=(await db.query(`SELECT COALESCE(NULLIF(mt.source,''),'(direct)') AS source,COUNT(DISTINCT oa.order_id)::integer AS orders,
      COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue
      FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN marketing_touches mt ON mt.id=oa.last_touch_id
      WHERE o.paid_at>=now()-interval '90 days'
      GROUP BY COALESCE(NULLIF(mt.source,''),'(direct)') ORDER BY revenue DESC LIMIT 5`)).rows;
    const topProduct=(await db.query(`SELECT oi.product_name,SUM(oi.subtotal_ex_vat)::numeric(14,2) AS revenue,COUNT(DISTINCT oi.order_id)::integer AS orders
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.paid_at>=now()-interval '90 days'
      GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 1`)).rows[0]||null;
    const contentTop=(await db.query(`SELECT COALESCE(NULLIF(mt.content,''),'(بدون محتوى)') AS content,
      COUNT(DISTINCT oa.order_id)::integer AS orders,COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue
      FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN marketing_touches mt ON mt.id=oa.last_touch_id
      WHERE o.paid_at>=now()-interval '90 days' AND NULLIF(mt.content,'') IS NOT NULL
      GROUP BY mt.content ORDER BY revenue DESC LIMIT 1`)).rows[0]||null;
    const actions=[];
    if((store?.products?.seo?.highPriority||0)>0)actions.push({priority:'high',title:'معالجة فرص SEO عالية الأولوية',reason:`هناك ${store.products.seo.highPriority} منتجًا بأولوية عالية.`,action:'ابدأ بأعلى المنتجات في SEO Queue وطبق التحسين الآمن ثم راقب الزيارات والتحويل.'});
    if((store?.customers?.atRisk||0)>0)actions.push({priority:'high',title:'تشغيل Win-back للعملاء المعرضين للفقد',reason:`تم رصد ${store.customers.atRisk} عميلًا متكررًا دون شراء حديث.`,action:'جهز رحلة استعادة للموافقين على التسويق مرتبطة بالصيانة والمنتج التالي المناسب.'});
    const aov=Number(revenueRows.aov||0);
    if(aov<300)actions.push({priority:'medium',title:'رفع متوسط قيمة الطلب',reason:`AOV الحالي ${aov.toFixed(0)} ر.س.`,action:'وسع Cross-sell وUpsell على صفحات المنتجات والسلة وراقب multi-item AOV.'});
    if(!channelRows.length)actions.push({priority:'high',title:'سد فجوة Attribution',reason:'لا توجد قنوات منسوبة كفاية للطلبات الأخيرة.',action:'تحقق من UTM وWooCommerce Order Attribution ثم راقب الطلبات الجديدة.'});
    if(commerceData?.dataQuality&&!commerceData.dataQuality.healthy)actions.push({priority:'medium',title:'تنظيف جودة بيانات المتجر',reason:`${commerceData.dataQuality.warnings.length} تحذير جودة بيانات موجود.`,action:'استبعد القيم الشاذة من القرار حتى تصحيح المصدر، ولا تستخدمها في ترتيب المنتجات.'});
    const summary={
      revenue:Number(revenueRows.revenue||0),orders:Number(revenueRows.orders||0),aov,
      topProduct,topChannel:channelRows[0]||null,topContent:contentTop,
      seo:{needsWork:store?.products?.seo?.needsWork||0,highPriority:store?.products?.seo?.highPriority||0},
      customers:{vip:store?.customers?.vipCustomers||0,repeat:store?.customers?.repeatCustomers||0,atRisk:store?.customers?.atRisk||0},
      dataQuality:commerceData?.dataQuality||null
    };
    const headline=summary.revenue>0?`حقق المتجر ${summary.revenue.toFixed(0)} ر.س من ${summary.orders} طلبًا خلال آخر 90 يومًا بمتوسط ${summary.aov.toFixed(0)} ر.س للطلب.`:'لا توجد مبيعات مدفوعة كافية في بيانات سبيل خلال آخر 90 يومًا.';
    return response(200,{generatedAt:new Date().toISOString(),headline,summary,actions:actions.slice(0,3)});
  }

  if(method==='GET'&&url==='/api/v1/marketing/autopilot/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const woo=createWooCommerceCatalogClient();
    let store=null;if(woo.configured){try{store=await woo.getStoreIntelligence()}catch{}}
    const seoRuns=(await db.query(`SELECT COUNT(*)::integer AS runs,
      COUNT(*) FILTER(WHERE COALESCE((data->>'changed')::boolean,false)=true)::integer AS changed_runs
      FROM audit_log WHERE action='ai.autopilot_seo_apply' AND created_at>=now()-interval '30 days'`)).rows[0]||{};
    const winback=(await db.query(`SELECT COUNT(*)::integer AS drafts,
      COUNT(*) FILTER(WHERE mc.status IN('queued','completed'))::integer AS progressed,
      COALESCE(SUM(cr.cnt),0)::integer AS recipients
      FROM marketing_campaigns mc
      LEFT JOIN LATERAL(SELECT COUNT(*)::integer AS cnt FROM campaign_recipients WHERE campaign_id=mc.id)cr ON true
      WHERE mc.name='Win-back 90 يوم' AND mc.created_at>=now()-interval '30 days'`)).rows[0]||{};
    const latestSeo=(await db.query(`SELECT entity_id,data,created_at FROM audit_log WHERE action='ai.autopilot_seo_apply' ORDER BY created_at DESC LIMIT 10`)).rows;
    return response(200,{seo:{runs:Number(seoRuns.runs||0),changedRuns:Number(seoRuns.changed_runs||0),currentBacklog:Number(store?.products?.seo?.needsWork||0),currentHighPriority:Number(store?.products?.seo?.highPriority||0),latest:latestSeo},winback:{drafts:Number(winback.drafts||0),progressed:Number(winback.progressed||0),recipients:Number(winback.recipients||0)}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/autopilot/history'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT id,actor_user_id,action,entity_type,entity_id,data,created_at
      FROM audit_log
      WHERE action IN('ai.autopilot_seo_apply','ai.autopilot_winback_draft')
      ORDER BY created_at DESC LIMIT 50`)).rows;
    return response(200,{history:rows});
  }

  if(method==='POST'&&url==='/api/v1/marketing/alerts/run'){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    return response(200,await scanMarketingAlerts(db,{actorUserId:context.userId,organizationId:context.tenantId||undefined}));
  }

  const nextBestDraftMatch=url.match(/^\/api\/v1\/marketing\/customers\/([^/]+)\/next-best-action-draft$/);
  if(method==='POST'&&nextBestDraftMatch){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const customerId=nextBestDraftMatch[1],productId=cleanOptional(body.productId),productName=cleanLongText(body.productName,200);
    if(!productId||!productName)return response(400,{error:'invalid_next_best_product'});
    const existing=(await db.query(`SELECT id FROM audit_log WHERE action='ai.next_best_action_draft' AND entity_type='customer' AND entity_id=$1 AND data->>'productId'=$2 AND created_at>=now()-interval '30 days' LIMIT 1`,[customerId,productId])).rows[0];
    if(existing)return response(200,{duplicate:true});
    await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.next_best_action_draft','customer',$2,$3::jsonb)`,[context.userId,customerId,JSON.stringify({productId,productName,status:'draft',createdAt:new Date().toISOString()})]);
    return response(201,{draft:{customerId,productId,productName,status:'draft'}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/next-best-action/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT al.id,al.entity_id AS customer_id,al.data->>'productId' AS product_id,al.data->>'productName' AS product_name,al.created_at,
      EXISTS(SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id::text=al.entity_id AND oi.product_id::text=al.data->>'productId' AND o.paid_at>al.created_at) AS converted
      FROM audit_log al WHERE al.action='ai.next_best_action_draft' ORDER BY al.created_at DESC LIMIT 100`)).rows;
    return response(200,{items:rows,summary:{drafts:rows.length,converted:rows.filter(x=>x.converted).length}});
  }

  const retentionDraftMatch=url.match(/^\/api\/v1\/marketing\/customers\/([^/]+)\/retention-journey-draft$/);
  if(method==='POST'&&retentionDraftMatch){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const customerId=retentionDraftMatch[1],journey=cleanOptional(body.journey),reason=cleanLongText(body.reason,300);
    const allowed=['maintenance_due','winback','vip_loyalty','repeat_growth','nurture'];
    if(!allowed.includes(journey))return response(400,{error:'invalid_retention_journey'});
    const existing=(await db.query(`SELECT id FROM audit_log WHERE action='ai.retention_journey_draft' AND entity_type='customer' AND entity_id=$1 AND data->>'journey'=$2 AND created_at>=now()-interval '30 days' LIMIT 1`,[customerId,journey])).rows[0];
    if(existing)return response(200,{duplicate:true});
    const messages={
      maintenance_due:'تذكير بصيانة الجهاز أو الفلتر قبل الموعد أو بعد تجاوزه.',
      winback:'إعادة تنشيط العميل بمحتوى وخدمة مناسبة دون خصم تلقائي.',
      vip_loyalty:'اقتراح مزايا ولاء وإحالة وخدمة مميزة للعميل مرتفع القيمة.',
      repeat_growth:'اقتراح Cross-sell أو Upsell مناسب بناءً على مشتريات العميل.',
      nurture:'استمرار التواصل بالمحتوى المناسب حتى ظهور إشارة أقوى.'
    };
    await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.retention_journey_draft','customer',$2,$3::jsonb)`,[context.userId,customerId,JSON.stringify({journey,reason,message:messages[journey],status:'draft',createdAt:new Date().toISOString()})]);
    return response(201,{draft:{customerId,journey,reason,message:messages[journey],status:'draft'}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/retention/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT al.id,al.entity_id AS customer_id,al.data->>'journey' AS journey,al.created_at,
      EXISTS(SELECT 1 FROM orders o WHERE o.customer_id::text=al.entity_id AND o.paid_at>al.created_at) AS converted
      FROM audit_log al WHERE al.action='ai.retention_journey_draft' ORDER BY al.created_at DESC LIMIT 100`)).rows;
    return response(200,{items:rows,summary:{drafts:rows.length,converted:rows.filter(x=>x.converted).length}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/retention-journeys'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`WITH base AS(
      SELECT c.id,c.name,
        COUNT(DISTINCT o.id)::integer AS orders,
        COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,
        MAX(o.paid_at) AS last_order_at,
        (SELECT MIN(a.next_maintenance_at) FROM installed_assets a WHERE a.customer_id=c.id AND a.status='active') AS next_maintenance_at
      FROM customers c
      LEFT JOIN orders o ON o.customer_id=c.id AND o.paid_at IS NOT NULL
      GROUP BY c.id,c.name
    )
    SELECT * FROM base ORDER BY revenue DESC,last_order_at DESC NULLS LAST LIMIT 100`)).rows;
    const journeys=rows.map(x=>{
      const daysToMaintenance=x.next_maintenance_at?Math.ceil((new Date(x.next_maintenance_at).getTime()-Date.now())/86400000):null;
      let journey='nurture',priority='low',reason='لا توجد إشارة أقوى حاليًا';
      if(daysToMaintenance!=null&&daysToMaintenance<=30){journey='maintenance_due';priority=daysToMaintenance<0?'high':'medium';reason=daysToMaintenance<0?'الصيانة متأخرة':'الصيانة مستحقة خلال 30 يومًا';}
      else if(x.last_order_at&&new Date(x.last_order_at).getTime()<Date.now()-180*86400000){journey='winback';priority='high';reason='لا يوجد طلب منذ أكثر من 180 يومًا';}
      else if(x.last_order_at&&new Date(x.last_order_at).getTime()<Date.now()-90*86400000){journey='winback';priority='medium';reason='لا يوجد طلب منذ أكثر من 90 يومًا';}
      else if(Number(x.orders)>=3||Number(x.revenue)>=3000){journey='vip_loyalty';priority='medium';reason='عميل مرتفع القيمة أو متكرر';}
      else if(Number(x.orders)>=2){journey='repeat_growth';priority='medium';reason='عميل متكرر قابل للـCross-sell والولاء';}
      return{customerId:String(x.id),name:x.name,orders:Number(x.orders||0),revenue:Number(x.revenue||0),lastOrderAt:x.last_order_at,nextMaintenanceAt:x.next_maintenance_at,journey,priority,reason};
    });
    const summary=journeys.reduce((a,x)=>{a[x.journey]=(a[x.journey]||0)+1;return a;},{});
    return response(200,{journeys,summary});
  }

  if(method==='GET'&&url==='/api/v1/marketing/customer-360'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const customers=(await db.query(`WITH base AS(
      SELECT c.id,c.name,
        COUNT(DISTINCT o.id)::integer AS orders,
        COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,
        MAX(o.paid_at) AS last_order_at,
        MIN(o.paid_at) AS first_order_at,
        COALESCE(AVG(o.total_ex_vat),0)::numeric(14,2) AS aov,
        (SELECT MIN(a.next_maintenance_at) FROM installed_assets a WHERE a.customer_id=c.id AND a.status='active') AS next_maintenance_at,
        (SELECT COUNT(*)::integer FROM installed_assets a WHERE a.customer_id=c.id AND a.status='active') AS active_assets
      FROM customers c
      LEFT JOIN orders o ON o.customer_id=c.id AND o.paid_at IS NOT NULL
      GROUP BY c.id,c.name
    )
    SELECT *,
      CASE
        WHEN orders>=3 OR revenue>=3000 THEN 'VIP'
        WHEN orders>=2 THEN 'repeat'
        WHEN revenue>=2000 THEN 'high_value'
        WHEN last_order_at<now()-interval '90 days' THEN 'dormant'
        ELSE 'standard' END AS segment,
      CASE
        WHEN last_order_at IS NULL THEN 'unknown'
        WHEN last_order_at<now()-interval '180 days' THEN 'high'
        WHEN last_order_at<now()-interval '90 days' THEN 'medium'
        ELSE 'low' END AS churn_risk,
      CASE
        WHEN orders=0 THEN 0
        ELSE ROUND((revenue/orders)*GREATEST(orders,1)*CASE WHEN last_order_at>=now()-interval '90 days' THEN 1.35 WHEN last_order_at>=now()-interval '180 days' THEN 1.10 ELSE 0.80 END,2)
      END AS estimated_ltv
    FROM base
    ORDER BY revenue DESC,last_order_at DESC NULLS LAST
    LIMIT 50`)).rows;
    const purchaseRows=(await db.query(`SELECT o.customer_id,oi.product_id,oi.product_name,SUM(oi.quantity)::numeric(14,2) AS units
      FROM orders o JOIN order_items oi ON oi.order_id=o.id
      WHERE o.paid_at IS NOT NULL
      GROUP BY o.customer_id,oi.product_id,oi.product_name`)).rows;
    const pairRows=(await db.query(`SELECT a.product_id AS a_id,a.product_name AS a_name,b.product_id AS b_id,b.product_name AS b_name,COUNT(DISTINCT a.order_id)::integer AS orders
      FROM order_items a JOIN order_items b ON b.order_id=a.order_id AND b.product_id<>a.product_id
      JOIN orders o ON o.id=a.order_id
      WHERE o.paid_at IS NOT NULL AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
      GROUP BY a.product_id,a.product_name,b.product_id,b.product_name
      ORDER BY orders DESC`)).rows;
    const owned=new Map(),topOwned=new Map();
    for(const p of purchaseRows){
      const key=String(p.customer_id),set=owned.get(key)||new Set();set.add(String(p.product_id));owned.set(key,set);
      const cur=topOwned.get(key);if(!cur||Number(p.units)>Number(cur.units))topOwned.set(key,p);
    }
    const suggestions=customers.map(c=>{
      const key=String(c.id),base=topOwned.get(key),seen=owned.get(key)||new Set();
      let next=null;
      if(base){
        next=pairRows.find(p=>String(p.a_id)===String(base.product_id)&&!seen.has(String(p.b_id)))||null;
      }
      return{...c,nextBestProduct:next?{id:String(next.b_id),name:next.b_name,coOrders:Number(next.orders),basedOn:{id:String(base.product_id),name:base.product_name}}:null};
    });
    const segments={VIP:0,repeat:0,high_value:0,dormant:0,standard:0};
    for(const x of suggestions)segments[x.segment]=(segments[x.segment]||0)+1;
    return response(200,{customers:suggestions,segments});
  }

  const profitDraftMatch=url.match(/^\/api\/v1\/marketing\/products\/([^/]+)\/profit-action-draft$/);
  if(method==='POST'&&profitDraftMatch){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const productId=profitDraftMatch[1],action=cleanOptional(body.action),productName=cleanLongText(body.productName,200),reason=cleanLongText(body.reason,500);
    const allowed=['push_cross_sell','feature_in_bundles','review_before_spend','monitor'];
    if(!allowed.includes(action)||!productName)return response(400,{error:'invalid_profit_action'});
    const existing=(await db.query(`SELECT id FROM audit_log WHERE action='ai.profit_action_draft' AND entity_type='woocommerce_product' AND entity_id=$1 AND data->>'action'=$2 AND created_at>=now()-interval '30 days' LIMIT 1`,[productId,action])).rows[0];
    if(existing)return response(200,{duplicate:true});
    await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.profit_action_draft','woocommerce_product',$2,$3::jsonb)`,[context.userId,productId,JSON.stringify({action,productName,reason,status:'draft',createdAt:new Date().toISOString()})]);
    return response(201,{draft:{productId,productName,action,reason,status:'draft'}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/profit-actions/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT al.id,al.entity_id AS product_id,al.data->>'productName' AS product_name,al.data->>'action' AS action,al.created_at,
      COALESCE((SELECT SUM(oi.subtotal_ex_vat-(oi.quantity*oi.unit_cost_snapshot)) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id::text=al.entity_id AND o.paid_at>al.created_at),0)::numeric(14,2) AS profit_after,
      COALESCE((SELECT COUNT(DISTINCT o.id) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id::text=al.entity_id AND o.paid_at>al.created_at),0)::integer AS orders_after
      FROM audit_log al WHERE al.action='ai.profit_action_draft' ORDER BY al.created_at DESC LIMIT 100`)).rows;
    return response(200,{items:rows,summary:{drafts:rows.length,withOrders:rows.filter(x=>Number(x.orders_after)>0).length,profitAfter:rows.reduce((s,x)=>s+Number(x.profit_after||0),0)}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/profit-decisions'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const products=(await db.query(`SELECT oi.product_id,oi.product_name,
      SUM(oi.subtotal_ex_vat)::numeric(14,2) AS revenue,
      SUM(oi.quantity*oi.unit_cost_snapshot)::numeric(14,2) AS cost,
      SUM(oi.subtotal_ex_vat-(oi.quantity*oi.unit_cost_snapshot))::numeric(14,2) AS gross_profit,
      COUNT(DISTINCT oi.order_id)::integer AS orders
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.paid_at>=now()-interval '90 days'
      GROUP BY oi.product_id,oi.product_name`)).rows;
    const decisions=products.map(x=>{
      const revenue=Number(x.revenue||0),profit=Number(x.gross_profit||0),margin=revenue?profit/revenue*100:0;
      let action='monitor',priority='low',reason='الهامش والحجم لا يتطلبان إجراء خاصًا.';
      if(margin>=35&&Number(x.orders)>=3){action='push_cross_sell';priority='high';reason='هامش قوي مع طلب متكرر؛ مناسب لتعزيز Cross-sell وUpsell.';}
      else if(margin<15&&revenue>0){action='review_before_spend';priority='high';reason='هامش منخفض؛ يفضل مراجعة التكلفة/السعر قبل زيادة الإنفاق أو الخصومات.';}
      else if(margin>=25&&Number(x.orders)>=2){action='feature_in_bundles';priority='medium';reason='هامش جيد؛ مناسب للباقات والمنتج التالي المقترح.';}
      return{productId:String(x.product_id||''),name:x.product_name,revenue,profit,margin,orders:Number(x.orders||0),action,priority,reason};
    }).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-({high:0,medium:1,low:2}[b.priority]))||b.profit-a.profit);
    return response(200,{decisions,summary:{
      pushCrossSell:decisions.filter(x=>x.action==='push_cross_sell').length,
      reviewBeforeSpend:decisions.filter(x=>x.action==='review_before_spend').length,
      featureInBundles:decisions.filter(x=>x.action==='feature_in_bundles').length
    }});
  }

  if(method==='GET'&&url==='/api/v1/marketing/channel-decisions'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const channels=(await db.query(`WITH order_profit AS(
      SELECT o.id,o.total_ex_vat,(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS net_profit
      FROM orders o
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(quantity*unit_cost_snapshot),0) AS product_cost FROM order_items WHERE order_id=o.id)items ON true
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(ts.payout_amount)FILTER(WHERE ts.status<>'rejected'),0) AS payout FROM service_jobs j JOIN technician_settlements ts ON ts.job_id=j.id WHERE j.order_id=o.id)pay ON true
      WHERE o.paid_at>=now()-interval '90 days'
    ), attributed AS(
      SELECT op.id,op.total_ex_vat,op.net_profit,COALESCE(NULLIF(mt.source,''),'(direct)') AS source
      FROM order_profit op LEFT JOIN order_attribution oa ON oa.order_id=op.id LEFT JOIN marketing_touches mt ON mt.id=oa.last_touch_id
    ), spend AS(
      SELECT source,COALESCE(SUM(amount),0)::numeric(14,2) AS spend FROM marketing_spend WHERE spent_on>=current_date-interval '90 days' GROUP BY source
    )
    SELECT a.source,COUNT(DISTINCT a.id)::integer AS orders,COALESCE(SUM(a.total_ex_vat),0)::numeric(14,2) AS revenue,
      COALESCE(SUM(a.net_profit),0)::numeric(14,2) AS profit,COALESCE(MAX(s.spend),0)::numeric(14,2) AS spend
    FROM attributed a LEFT JOIN spend s ON s.source=a.source GROUP BY a.source`)).rows;
    const decisions=channels.map(x=>{
      const revenue=Number(x.revenue||0),profit=Number(x.profit||0),spend=Number(x.spend||0),margin=revenue?profit/revenue*100:0,profitRoas=spend>0?profit/spend:null;
      let action='monitor',priority='low',reason='لا توجد إشارة قوية تستدعي إجراء خاصًا.';
      if(x.source==='(direct)'){action='fix_attribution';priority='medium';reason='نسبة كبيرة من الطلبات منسوبة Direct؛ تحسين UTM والإسناد سيعطي رؤية أدق.';}
      else if(spend>0&&profitRoas!=null&&profitRoas<1){action='review_spend';priority='high';reason='الربح المنسوب أقل من الإنفاق المسجل؛ راجع القناة قبل زيادة الميزانية.';}
      else if(profit>0&&margin>=25&&Number(x.orders)>=3){action='scale_focus';priority='high';reason='القناة تحقق ربحًا وهامشًا جيدًا مع حجم طلبات مناسب؛ تستحق مزيدًا من التركيز.';}
      else if(revenue>0&&margin<15){action='optimize_offer';priority='medium';reason='القناة تجلب إيرادًا لكن الهامش منخفض؛ راجع العرض والمنتج قبل التوسع.';}
      return{source:x.source,orders:Number(x.orders||0),revenue,profit,margin,spend,profitRoas,action,priority,reason};
    }).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-({high:0,medium:1,low:2}[b.priority]))||b.profit-a.profit);
    return response(200,{decisions,summary:{
      scaleFocus:decisions.filter(x=>x.action==='scale_focus').length,
      reviewSpend:decisions.filter(x=>x.action==='review_spend').length,
      fixAttribution:decisions.filter(x=>x.action==='fix_attribution').length,
      optimizeOffer:decisions.filter(x=>x.action==='optimize_offer').length
    }});
  }

  const channelDraftMatch=url.match(/^\/api\/v1\/marketing\/channels\/([^/]+)\/decision-draft$/);
  if(method==='POST'&&channelDraftMatch){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const source=decodeURIComponent(channelDraftMatch[1]),action=cleanOptional(body.action),reason=cleanLongText(body.reason,500);
    const allowed=['scale_focus','review_spend','fix_attribution','optimize_offer','monitor'];
    if(!allowed.includes(action))return response(400,{error:'invalid_channel_action'});
    const existing=(await db.query(`SELECT id FROM audit_log WHERE action='ai.channel_decision_draft' AND entity_type='marketing_channel' AND entity_id=$1 AND data->>'action'=$2 AND created_at>=now()-interval '30 days' LIMIT 1`,[source,action])).rows[0];
    if(existing)return response(200,{duplicate:true});
    await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.channel_decision_draft','marketing_channel',$2,$3::jsonb)`,[context.userId,source,JSON.stringify({action,reason,status:'draft',createdAt:new Date().toISOString()})]);
    return response(201,{draft:{source,action,reason,status:'draft'}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/channel-decisions/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT al.id,al.entity_id AS source,al.data->>'action' AS action,al.created_at,
      COALESCE((SELECT SUM(o.total_ex_vat) FROM orders o JOIN order_attribution oa ON oa.order_id=o.id JOIN marketing_touches mt ON mt.id=oa.last_touch_id WHERE COALESCE(NULLIF(mt.source,''),'(direct)')=al.entity_id AND o.paid_at>al.created_at),0)::numeric(14,2) AS revenue_after
      FROM audit_log al WHERE al.action='ai.channel_decision_draft' ORDER BY al.created_at DESC LIMIT 100`)).rows;
    return response(200,{items:rows,summary:{drafts:rows.length,withRevenue:rows.filter(x=>Number(x.revenue_after)>0).length,revenueAfter:rows.reduce((s,x)=>s+Number(x.revenue_after||0),0)}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/channel-profitability'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const channels=(await db.query(`WITH order_profit AS(
      SELECT o.id,o.total_ex_vat,
        (o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS net_profit
      FROM orders o
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(quantity*unit_cost_snapshot),0) AS product_cost FROM order_items WHERE order_id=o.id)items ON true
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(ts.payout_amount)FILTER(WHERE ts.status<>'rejected'),0) AS payout FROM service_jobs j JOIN technician_settlements ts ON ts.job_id=j.id WHERE j.order_id=o.id)pay ON true
      WHERE o.paid_at>=now()-interval '90 days'
    ), attributed AS(
      SELECT op.id,op.total_ex_vat,op.net_profit,COALESCE(NULLIF(mt.source,''),'(direct)') AS source
      FROM order_profit op
      LEFT JOIN order_attribution oa ON oa.order_id=op.id
      LEFT JOIN marketing_touches mt ON mt.id=oa.last_touch_id
    ), spend AS(
      SELECT source,COALESCE(SUM(amount),0)::numeric(14,2) AS spend
      FROM marketing_spend
      WHERE spent_on>=current_date-interval '90 days'
      GROUP BY source
    )
    SELECT a.source,
      COUNT(DISTINCT a.id)::integer AS orders,
      COALESCE(SUM(a.total_ex_vat),0)::numeric(14,2) AS revenue,
      COALESCE(SUM(a.net_profit),0)::numeric(14,2) AS profit,
      COALESCE(MAX(s.spend),0)::numeric(14,2) AS spend
    FROM attributed a LEFT JOIN spend s ON s.source=a.source
    GROUP BY a.source
    ORDER BY profit DESC`)).rows.map(x=>{
      const revenue=Number(x.revenue||0),profit=Number(x.profit||0),spend=Number(x.spend||0),margin=revenue?profit/revenue*100:0;
      const roas=spend>0?revenue/spend:null,profitRoas=spend>0?profit/spend:null;
      let status='healthy',note='القناة تحقق مساهمة ربحية مقبولة.';
      if(revenue>0&&margin<15){status='low_margin';note='الإيراد موجود لكن هامش الربح منخفض.';}
      if(spend>0&&profitRoas!=null&&profitRoas<1){status='unprofitable_spend';note='الربح المنسوب أقل من الإنفاق المسجل على القناة.';}
      if(spend===0){status='no_spend_data';note='لا يوجد إنفاق مسجل؛ لا يمكن احتساب ROAS بدقة.';}
      return{source:x.source,orders:Number(x.orders||0),revenue,profit,margin,spend,roas,profitRoas,status,note};
    });
    return response(200,{channels,summary:{
      profitable:channels.filter(x=>x.profit>0).length,
      lowMargin:channels.filter(x=>x.status==='low_margin').length,
      unprofitableSpend:channels.filter(x=>x.status==='unprofitable_spend').length,
      missingSpend:channels.filter(x=>x.status==='no_spend_data').length
    }});
  }

  const bundleDraftMatch=url.match(/^\/api\/v1\/marketing\/bundles\/([^/]+)\/([^/]+)\/bundle-action-draft$/);
  if(method==='POST'&&bundleDraftMatch){
    if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});
    if(!context.userId)return response(401,{error:'user_identity_required'});
    const aId=bundleDraftMatch[1],bId=bundleDraftMatch[2],action=cleanOptional(body.action),aName=cleanLongText(body.aName,200),bName=cleanLongText(body.bName,200),reason=cleanLongText(body.reason,500);
    const allowed=['bundle_candidate','test_bundle','review_bundle_margin','monitor'];
    if(!allowed.includes(action)||!aName||!bName)return response(400,{error:'invalid_bundle_action'});
    const key=[aId,bId].sort().join('|');
    const existing=(await db.query(`SELECT id FROM audit_log WHERE action='ai.bundle_action_draft' AND entity_type='product_bundle' AND entity_id=$1 AND data->>'action'=$2 AND created_at>=now()-interval '30 days' LIMIT 1`,[key,action])).rows[0];
    if(existing)return response(200,{duplicate:true});
    await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.bundle_action_draft','product_bundle',$2,$3::jsonb)`,[context.userId,key,JSON.stringify({aId,bId,aName,bName,action,reason,status:'draft',createdAt:new Date().toISOString()})]);
    return response(201,{draft:{bundleKey:key,aId,bId,aName,bName,action,reason,status:'draft'}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/bundle-actions/effectiveness'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT al.id,al.entity_id AS bundle_key,al.data->>'aId' AS a_id,al.data->>'bId' AS b_id,al.data->>'aName' AS a_name,al.data->>'bName' AS b_name,al.data->>'action' AS action,al.created_at,
      COALESCE((SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items a ON a.order_id=o.id JOIN order_items b ON b.order_id=o.id AND b.product_id::text=al.data->>'bId' WHERE a.product_id::text=al.data->>'aId' AND o.paid_at>al.created_at),0)::integer AS orders_after,
      COALESCE((SELECT SUM((a.subtotal_ex_vat-(a.quantity*a.unit_cost_snapshot))+(b.subtotal_ex_vat-(b.quantity*b.unit_cost_snapshot))) FROM orders o JOIN order_items a ON a.order_id=o.id JOIN order_items b ON b.order_id=o.id AND b.product_id::text=al.data->>'bId' WHERE a.product_id::text=al.data->>'aId' AND o.paid_at>al.created_at),0)::numeric(14,2) AS profit_after
      FROM audit_log al WHERE al.action='ai.bundle_action_draft' ORDER BY al.created_at DESC LIMIT 100`)).rows;
    return response(200,{items:rows,summary:{drafts:rows.length,withOrders:rows.filter(x=>Number(x.orders_after)>0).length,profitAfter:rows.reduce((s,x)=>s+Number(x.profit_after||0),0)}});
  }

  if(method==='GET'&&url==='/api/v1/marketing/bundle-profitability'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`WITH paid_items AS(
      SELECT o.id AS order_id,o.total_ex_vat,oi.product_id,oi.product_name,oi.subtotal_ex_vat,
        (oi.quantity*oi.unit_cost_snapshot)::numeric(14,2) AS product_cost
      FROM orders o JOIN order_items oi ON oi.order_id=o.id
      WHERE o.paid_at>=now()-interval '90 days'
    ), pairs AS(
      SELECT a.product_id AS a_id,a.product_name AS a_name,b.product_id AS b_id,b.product_name AS b_name,
        COUNT(DISTINCT a.order_id)::integer AS orders,
        SUM(a.subtotal_ex_vat+b.subtotal_ex_vat)::numeric(14,2) AS pair_revenue,
        SUM((a.subtotal_ex_vat-a.product_cost)+(b.subtotal_ex_vat-b.product_cost))::numeric(14,2) AS pair_profit,
        AVG(o.total_ex_vat)::numeric(14,2) AS avg_order
      FROM paid_items a
      JOIN paid_items b ON b.order_id=a.order_id AND b.product_id>a.product_id
      JOIN orders o ON o.id=a.order_id
      GROUP BY a.product_id,a.product_name,b.product_id,b.product_name
    )
    SELECT * FROM pairs ORDER BY orders DESC,pair_profit DESC LIMIT 30`)).rows.map(x=>{
      const revenue=Number(x.pair_revenue||0),profit=Number(x.pair_profit||0),margin=revenue?profit/revenue*100:0;
      let action='monitor',priority='low',reason='التركيبة تحتاج بيانات أكثر قبل تحويلها لباقـة.';
      if(Number(x.orders)>=2&&margin>=30){action='bundle_candidate';priority='high';reason='التركيبة تتكرر بهامش قوي؛ مناسبة كباقة أو Cross-sell بارز.';}
      else if(Number(x.orders)>=2&&margin<15){action='review_bundle_margin';priority='high';reason='التركيبة تتكرر لكن هامشها منخفض؛ راجع التسعير والتكلفة قبل الترويج.';}
      else if(Number(x.orders)>=2&&margin>=20){action='test_bundle';priority='medium';reason='التركيبة واعدة وتستحق اختبار باقة دون خصم تلقائي.';}
      return{...x,orders:Number(x.orders||0),pairRevenue:revenue,pairProfit:profit,margin,avgOrder:Number(x.avg_order||0),action,priority,reason};
    });
    return response(200,{bundles:rows,summary:{
      candidates:rows.filter(x=>x.action==='bundle_candidate').length,
      tests:rows.filter(x=>x.action==='test_bundle').length,
      lowMargin:rows.filter(x=>x.action==='review_bundle_margin').length
    }});
  }

  if(method==='GET'&&url==='/api/v1/marketing/profit-intelligence'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const summary=(await db.query(`SELECT
      COUNT(*)::integer AS orders,
      COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,
      COALESCE(SUM(items.product_cost),0)::numeric(14,2) AS product_cost,
      COALESCE(SUM(COALESCE(oc.other_costs,0)),0)::numeric(14,2) AS other_costs,
      COALESCE(SUM(pay.payout),0)::numeric(14,2) AS technician_payout,
      COALESCE(SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout),0)::numeric(14,2) AS net_profit
      FROM orders o
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(quantity*unit_cost_snapshot),0) AS product_cost FROM order_items WHERE order_id=o.id)items ON true
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(ts.payout_amount)FILTER(WHERE ts.status<>'rejected'),0) AS payout FROM service_jobs j JOIN technician_settlements ts ON ts.job_id=j.id WHERE j.order_id=o.id)pay ON true
      WHERE o.paid_at>=now()-interval '90 days'`)).rows[0]||{};
    const products=(await db.query(`SELECT oi.product_id,oi.product_name,
      SUM(oi.subtotal_ex_vat)::numeric(14,2) AS revenue,
      SUM(oi.quantity*oi.unit_cost_snapshot)::numeric(14,2) AS product_cost,
      SUM(oi.subtotal_ex_vat-(oi.quantity*oi.unit_cost_snapshot))::numeric(14,2) AS gross_profit
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.paid_at>=now()-interval '90 days'
      GROUP BY oi.product_id,oi.product_name
      ORDER BY gross_profit DESC LIMIT 20`)).rows;
    const revenue=Number(summary.revenue||0),profit=Number(summary.net_profit||0),margin=revenue?profit/revenue*100:0;
    const dailyProfit90=profit/90,dailyProfit30=Number((await db.query(`SELECT COALESCE(SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout),0)::numeric(14,2) AS net_profit
      FROM orders o
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(quantity*unit_cost_snapshot),0) AS product_cost FROM order_items WHERE order_id=o.id)items ON true
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(ts.payout_amount)FILTER(WHERE ts.status<>'rejected'),0) AS payout FROM service_jobs j JOIN technician_settlements ts ON ts.job_id=j.id WHERE j.order_id=o.id)pay ON true
      WHERE o.paid_at>=now()-interval '30 days'`)).rows[0]?.net_profit||0)/30;
    const blended=(dailyProfit30*0.65)+(dailyProfit90*0.35);
    const risks=products.filter(x=>Number(x.revenue)>0&&Number(x.gross_profit)/Number(x.revenue)*100<15).slice(0,5).map(x=>({productId:x.product_id,name:x.product_name,margin:Number(x.gross_profit)/Number(x.revenue)*100}));
    return response(200,{summary:{...summary,margin},forecast:{days30:blended*30,days90:blended*90},products,risks});
  }

  if(method==='GET'&&url==='/api/v1/marketing/revenue-forecast'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const [r30,r90,topCustomer,topProduct,total90]=await Promise.all([
      db.query(`SELECT COALESCE(SUM(total_ex_vat),0)::numeric(14,2) AS revenue,COUNT(*)::integer AS orders FROM orders WHERE paid_at>=now()-interval '30 days'`),
      db.query(`SELECT COALESCE(SUM(total_ex_vat),0)::numeric(14,2) AS revenue,COUNT(*)::integer AS orders FROM orders WHERE paid_at>=now()-interval '90 days'`),
      db.query(`SELECT c.id,c.name,COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.paid_at>=now()-interval '90 days' GROUP BY c.id,c.name ORDER BY revenue DESC LIMIT 1`),
      db.query(`SELECT oi.product_id,oi.product_name,COALESCE(SUM(oi.subtotal_ex_vat),0)::numeric(14,2) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.paid_at>=now()-interval '90 days' GROUP BY oi.product_id,oi.product_name ORDER BY revenue DESC LIMIT 1`),
      db.query(`SELECT COALESCE(SUM(total_ex_vat),0)::numeric(14,2) AS revenue FROM orders WHERE paid_at>=now()-interval '90 days'`)
    ]);
    const rev30=Number(r30.rows[0]?.revenue||0),rev90=Number(r90.rows[0]?.revenue||0),daily30=rev30/30,daily90=rev90/90;
    const blended=(daily30*0.65)+(daily90*0.35),forecast30=blended*30,forecast90=blended*90,total=Number(total90.rows[0]?.revenue||0);
    const tc=topCustomer.rows[0]||null,tp=topProduct.rows[0]||null;
    const customerShare=tc&&total?Number(tc.revenue)/total*100:0,productShare=tp&&total?Number(tp.revenue)/total*100:0;
    const risks=[];
    if(customerShare>35)risks.push({type:'customer_concentration',priority:'high',message:`أعلى عميل يمثل ${customerShare.toFixed(1)}% من إيراد آخر 90 يومًا.`});
    if(productShare>50)risks.push({type:'product_concentration',priority:'high',message:`أعلى منتج يمثل ${productShare.toFixed(1)}% من إيراد آخر 90 يومًا.`});
    if(daily30<daily90*0.8&&rev90>0)risks.push({type:'revenue_slowdown',priority:'medium',message:'متوسط الإيراد اليومي آخر 30 يومًا أقل بأكثر من 20% من متوسط 90 يومًا.'});
    return response(200,{actual:{revenue30:rev30,revenue90:rev90,orders30:Number(r30.rows[0]?.orders||0),orders90:Number(r90.rows[0]?.orders||0),daily30,daily90},forecast:{days30:forecast30,days90:forecast90,method:'65% last30 + 35% last90 daily average'},concentration:{topCustomer:tc?{...tc,share:customerShare}:null,topProduct:tp?{...tp,share:productShare}:null},risks});
  }

  if(method==='GET'&&url==='/api/v1/marketing/revenue-intelligence'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const [summary,products,channels,segments]=await Promise.all([
      db.query(`SELECT COUNT(*)::integer AS orders,COALESCE(SUM(total_ex_vat),0)::numeric(14,2) AS revenue,
        COALESCE(AVG(total_ex_vat),0)::numeric(14,2) AS aov
        FROM orders WHERE paid_at>=now()-interval '90 days'`),
      db.query(`SELECT oi.product_id,oi.product_name,SUM(oi.quantity)::numeric(14,2) AS units,
        SUM(oi.subtotal_ex_vat)::numeric(14,2) AS revenue,
        COUNT(DISTINCT oi.order_id)::integer AS orders
        FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE o.paid_at>=now()-interval '90 days'
        GROUP BY oi.product_id,oi.product_name ORDER BY revenue DESC LIMIT 20`),
      db.query(`SELECT COALESCE(NULLIF(mt.source,''),'(direct)') AS source,
        COUNT(DISTINCT oa.order_id)::integer AS orders,
        COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue
        FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN marketing_touches mt ON mt.id=oa.last_touch_id
        WHERE o.paid_at>=now()-interval '90 days'
        GROUP BY COALESCE(NULLIF(mt.source,''),'(direct)') ORDER BY revenue DESC`),
      db.query(`WITH spend AS(
        SELECT c.id,c.name,COUNT(o.id)::integer AS orders,COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,
          MAX(o.paid_at) AS last_order_at
        FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.paid_at>=now()-interval '365 days'
        GROUP BY c.id,c.name
      )
      SELECT CASE
        WHEN orders>=3 OR revenue>=3000 THEN 'VIP'
        WHEN orders>=2 THEN 'repeat'
        WHEN revenue>=2000 THEN 'high_value'
        WHEN last_order_at<now()-interval '90 days' THEN 'dormant'
        ELSE 'standard' END AS segment,
        COUNT(*)::integer AS customers,COALESCE(SUM(revenue),0)::numeric(14,2) AS revenue
      FROM spend GROUP BY 1 ORDER BY revenue DESC`)
    ]);
    const s=summary.rows[0]||{orders:0,revenue:0,aov:0};
    const alerts=[];
    if(Number(s.orders)>0&&Number(s.aov)<300)alerts.push({type:'aov_low',priority:'medium',message:'متوسط قيمة الطلب أقل من 300 ر.س خلال آخر 90 يومًا.'});
    if((channels.rows||[]).length===0)alerts.push({type:'attribution_gap',priority:'high',message:'لا توجد قنوات منسوبة للمبيعات في الفترة الحالية.'});
    const dominant=products.rows?.[0];
    if(dominant&&Number(s.revenue)>0&&Number(dominant.revenue)/Number(s.revenue)>0.5)alerts.push({type:'product_concentration',priority:'medium',message:`أكثر من 50% من الإيراد يعتمد على المنتج: ${dominant.product_name}`});
    return response(200,{summary:s,products:products.rows,channels:channels.rows,segments:segments.rows,alerts});
  }

  if(method==='GET'&&url==='/api/v1/marketing/content-attribution'){
    if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});
    const rows=(await db.query(`SELECT
      COALESCE(NULLIF(mt.content,''),'(بدون محتوى)') AS content,
      mt.source,
      mt.medium,
      mt.campaign,
      COUNT(DISTINCT oa.order_id)::integer AS orders,
      COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue
      FROM order_attribution oa
      JOIN orders o ON o.id=oa.order_id
      JOIN marketing_touches mt ON mt.id=oa.last_touch_id
      WHERE o.paid_at>=now()-interval '90 days'
      GROUP BY mt.content,mt.source,mt.medium,mt.campaign
      ORDER BY revenue DESC,orders DESC
      LIMIT 50`)).rows;
    return response(200,{attribution:rows});
  }

  if(method==='GET'&&url==='/api/v1/marketing/attribution'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});const range=parseDateRange(context.from,context.to);if(!range)return response(400,{error:'invalid_date_range'});return response(200,{...(await createRepositories(db).marketing.attribution(range.from,range.to)),range});}
  if(method==='POST'&&url==='/api/v1/marketing/touches'){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});const visitorId=cleanOptional(body.visitorId),customerId=cleanOptional(body.customerId),source=cleanOptional(body.source),medium=cleanOptional(body.medium),campaign=cleanOptional(body.campaign),content=cleanOptional(body.content),term=cleanOptional(body.term),landingUrl=cleanOptional(body.landingUrl),occurredAt=body.occurredAt?parseDate(body.occurredAt):new Date().toISOString();if((!visitorId&&!customerId)||!source||source.length>100||medium.length>100||campaign.length>200||content.length>200||term.length>200||landingUrl.length>2000||!occurredAt)return response(400,{error:'invalid_marketing_touch'});return response(201,{touch:await recordTouch(db,{visitorId,customerId,source,medium,campaign,content,term,landingUrl,occurredAt})});}
  if(method==='POST'&&url==='/api/v1/marketing/spend'){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const source=cleanOptional(body.source),campaign=cleanOptional(body.campaign),amount=Number(body.amount),spentOn=cleanOptional(body.spentOn),currency=(cleanOptional(body.currency)||'SAR').toUpperCase();if(!source||source.length>100||campaign.length>200||!validInventoryNumber(amount,true)||!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)||currency.length!==3)return response(400,{error:'invalid_marketing_spend'});return response(201,{spend:await recordSpend(db,{source,campaign,amount,spentOn,currency,actorUserId:context.userId})});}
  const attributeOrderMatch=url.match(/^\/api\/v1\/marketing\/orders\/([^/]+)\/attribute$/);if(method==='POST'&&attributeOrderMatch){if(!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const result=await attributeOrder(db,{orderId:attributeOrderMatch[1],visitorId:cleanOptional(body.visitorId),actorUserId:context.userId});return result?response(200,result):response(404,{error:'order_not_found'});}

  if(method==='GET'&&url==='/api/v1/conversations/stats'){if(!can(role,'conversations:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).marketing.conversationStats()});}
  if(method==='GET'&&url==='/api/v1/conversations'){if(!can(role,'conversations:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'active',channel=context.channel||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','active','open','pending_agent','waiting_customer','closed'].includes(status)||!['all','whatsapp','email','instagram','x','sms','webchat'].includes(channel))return response(400,{error:'invalid_conversation_filter'});const rows=await createRepositories(db).marketing.conversations({...pagination,status,channel,query:context.query||''});return response(200,{conversations:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status,channel});}
  const conversationMatch=url.match(/^\/api\/v1\/conversations\/([^/]+)$/);if(method==='GET'&&conversationMatch){if(!can(role,'conversations:read'))return response(403,{error:'forbidden'});const thread=await createRepositories(db).marketing.conversationThread(conversationMatch[1]);return thread?response(200,thread):response(404,{error:'conversation_not_found'});}
  if(method==='POST'&&url==='/api/v1/conversations/inbound'){if(!can(role,'conversations:update'))return response(403,{error:'forbidden'});const channel=cleanOptional(body.channel),externalThreadId=cleanOptional(body.externalThreadId),externalMessageId=cleanOptional(body.externalMessageId),messageBody=cleanLongText(body.body,5000),sentAt=body.sentAt?parseDate(body.sentAt):new Date().toISOString();if(!['whatsapp','email','instagram','x','sms','webchat'].includes(channel)||!externalThreadId||externalThreadId.length>500||!messageBody||!sentAt)return response(400,{error:'invalid_inbound_message'});return response(201,await ingestConversationMessage(db,{customerId:cleanOptional(body.customerId),channel,externalThreadId,externalMessageId,contactHandle:cleanOptional(body.contactHandle),subject:cleanOptional(body.subject),body:messageBody,sentAt,metadata:body.metadata&&typeof body.metadata==='object'?body.metadata:{}}));}
  const conversationReplyMatch=url.match(/^\/api\/v1\/conversations\/([^/]+)\/reply$/);if(method==='POST'&&conversationReplyMatch){if(!can(role,'conversations:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const messageBody=cleanLongText(body.body,5000);if(!messageBody)return response(400,{error:'message_required'});try{const result=await replyToConversation(db,{conversationId:conversationReplyMatch[1],body:messageBody,actorUserId:context.userId});return result?response(201,result):response(404,{error:'conversation_not_found'});}catch(error){if(error.message.includes('closed'))return response(409,{error:'conversation_closed'});throw error;}}
  if(method==='PATCH'&&conversationMatch){if(!can(role,'conversations:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const status=body.status===undefined?'':cleanOptional(body.status),priority=body.priority===undefined?'':cleanOptional(body.priority),assignProvided=Object.prototype.hasOwnProperty.call(body,'assignedTo'),assignedTo=assignProvided?cleanOptional(body.assignedTo):'';if((status&&!['open','pending_agent','waiting_customer','closed'].includes(status))||(priority&&!['low','normal','high','urgent'].includes(priority))||(assignProvided&&body.assignedTo!==null&&!assignedTo)||(!status&&!priority&&!assignProvided))return response(400,{error:'invalid_conversation_update'});const conversation=await updateConversation(db,{conversationId:conversationMatch[1],status,priority,assignProvided,assignedTo,actorUserId:context.userId});return conversation?response(200,{conversation}):response(404,{error:'conversation_not_found'});}

  if(method==='GET'&&url==='/api/v1/ai/stats'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.stats()});}
  if(method==='GET'&&url==='/api/v1/ai/suggestions'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','draft','approved','rejected','used'].includes(status))return response(400,{error:'invalid_ai_suggestion_status'});const rows=await createRepositories(db).ai.suggestions({...pagination,status});return response(200,{suggestions:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status});}
  if(method==='GET'&&url==='/api/v1/ai/knowledge'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'approved';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','draft','approved','archived'].includes(status))return response(400,{error:'invalid_knowledge_status'});const rows=await createRepositories(db).ai.knowledge({...pagination,status});return response(200,{articles:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status});}
  const aiSuggestMatch=url.match(/^\/api\/v1\/ai\/conversations\/([^/]+)\/suggest$/);if(method==='POST'&&aiSuggestMatch){if(!can(role,'ai:suggest'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const suggestion=await createCareSuggestion(db,{conversationId:aiSuggestMatch[1],actorUserId:context.userId});return suggestion?response(201,{suggestion}):response(404,{error:'conversation_not_found'});}
  const aiReviewMatch=url.match(/^\/api\/v1\/ai\/suggestions\/([^/]+)\/(approve|reject)$/);if(method==='POST'&&aiReviewMatch){if(!can(role,'ai:approve'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const suggestion=await reviewSuggestion(db,{suggestionId:aiReviewMatch[1],decision:aiReviewMatch[2]==='approve'?'approved':'rejected',actorUserId:context.userId});return suggestion?response(200,{suggestion}):response(409,{error:'suggestion_not_reviewable'});}
  const aiUseMatch=url.match(/^\/api\/v1\/ai\/suggestions\/([^/]+)\/use$/);if(method==='POST'&&aiUseMatch){if(!can(role,'ai:suggest'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});try{const result=await useSuggestion(db,{suggestionId:aiUseMatch[1],actorUserId:context.userId});return result?response(200,result):response(404,{error:'suggestion_not_found'});}catch(error){if(error.message.includes('not approved')||error.message.includes('unavailable'))return response(409,{error:'suggestion_not_usable'});throw error;}}
  if(method==='POST'&&url==='/api/v1/ai/knowledge'){if(!can(role,'ai:manage'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const title=cleanOptional(body.title),category=cleanOptional(body.category)||'general',content=cleanLongText(body.content,10000),keywords=Array.isArray(body.keywords)?body.keywords.map(cleanOptional).filter(Boolean).slice(0,30):[],status=cleanOptional(body.status)||'approved';if(title.length<3||!content||category.length>100||!['draft','approved'].includes(status))return response(400,{error:'invalid_knowledge_article'});return response(201,{article:await createKnowledgeArticle(db,{title,category,content,keywords,status,actorUserId:context.userId})});}
  if(method==='GET'&&url==='/api/v1/ai/insights/stats'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.insightStats()});}
  if(method==='GET'&&url==='/api/v1/ai/insights'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'open',domain=context.domain||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','open','acknowledged','resolved','dismissed'].includes(status)||!['all','operations','finance','inventory','marketing','customer_care'].includes(domain))return response(400,{error:'invalid_insight_filter'});const rows=await createRepositories(db).ai.insights({...pagination,status,domain});return response(200,{insights:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status,domain});}
  if(method==='GET'&&url==='/api/v1/ai/brief'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{brief:await createRepositories(db).ai.latestBrief()});}
  if(method==='POST'&&url==='/api/v1/ai/insights/run'){if(!can(role,'ai:manage'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const date=body.date?cleanOptional(body.date):new Date().toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return response(400,{error:'invalid_brief_date'});return response(200,await generateExecutiveInsights(db,{actorUserId:context.userId,date}));}
  const insightUpdateMatch=url.match(/^\/api\/v1\/ai\/insights\/([^/]+)$/);if(method==='PATCH'&&insightUpdateMatch){if(!can(role,'ai:manage'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const status=cleanOptional(body.status),note=cleanLongText(body.note,1000);if(!['acknowledged','resolved','dismissed'].includes(status)||(status==='resolved'&&note.length<3))return response(400,{error:'invalid_insight_update'});const insight=await updateInsight(db,{insightId:insightUpdateMatch[1],status,note,actorUserId:context.userId});return insight?response(200,{insight}):response(409,{error:'insight_not_open'});}
  if(method==='GET'&&url==='/api/v1/ai/dispatch/stats'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.dispatchStats()});}
  if(method==='GET'&&url==='/api/v1/ai/dispatch/queue'){if(!can(role,'ai:dispatch'))return response(403,{error:'forbidden'});const pagination=parsePagination(context);if(!pagination)return response(400,{error:'invalid_pagination'});const rows=await createRepositories(db).ai.dispatchQueue(pagination);return response(200,{jobs:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0}});}
  if(method==='GET'&&url==='/api/v1/ai/dispatch/recommendations'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','pending','approved','rejected','expired'].includes(status))return response(400,{error:'invalid_dispatch_recommendation_status'});const rows=await createRepositories(db).ai.dispatchRecommendations({...pagination,status});return response(200,{recommendations:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status});}
  const dispatchSuggestMatch=url.match(/^\/api\/v1\/ai\/jobs\/([^/]+)\/dispatch-recommendation$/);if(method==='POST'&&dispatchSuggestMatch){if(!can(role,'ai:dispatch')||!can(role,'jobs:assign'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const windowStart=body.windowStart?parseDate(body.windowStart):null,windowEnd=body.windowEnd?parseDate(body.windowEnd):null,limit=Number(body.limit??10);if((body.windowStart&&!windowStart)||(body.windowEnd&&!windowEnd)||(windowStart&&windowEnd&&windowStart>=windowEnd)||!Number.isInteger(limit)||limit<1||limit>30)return response(400,{error:'invalid_dispatch_recommendation'});try{return response(201,await createDispatchRecommendation(db,{jobId:dispatchSuggestMatch[1],windowStart,windowEnd,limit,actorUserId:context.userId}));}catch(error){if(error.message.includes('not found'))return response(404,{error:'job_not_found'});if(error.message.includes('not dispatchable'))return response(409,{error:'job_not_dispatchable'});throw error;}}
  const dispatchReviewMatch=url.match(/^\/api\/v1\/ai\/dispatch\/([^/]+)\/(approve|reject)$/);if(method==='POST'&&dispatchReviewMatch){if(!can(role,'ai:dispatch')||!can(role,'jobs:assign'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const decision=dispatchReviewMatch[2]==='approve'?'approved':'rejected',technicianId=cleanOptional(body.technicianId),note=cleanLongText(body.note,1000);if(decision==='rejected'&&note.length<3)return response(400,{error:'review_note_required'});try{const recommendation=await reviewDispatchRecommendation(db,{recommendationId:dispatchReviewMatch[1],decision,technicianId,note,actorUserId:context.userId});return recommendation?response(200,{recommendation}):response(409,{error:'recommendation_not_reviewable'});}catch(error){if(error.message.includes('not a candidate'))return response(400,{error:'invalid_selected_technician'});throw error;}}
  if(method==='GET'&&url==='/api/v1/ai/sales/stats'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.salesStats()});}
  if(method==='GET'&&url==='/api/v1/ai/sales/opportunities'){if(!can(role,'ai:sales'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'active',type=context.type||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','active','new','approved','contacted','converted','dismissed','lost'].includes(status)||!['all','maintenance_due','cart_recovery','cross_sell','win_back','conversation_followup'].includes(type))return response(400,{error:'invalid_sales_opportunity_filter'});const rows=await createRepositories(db).ai.salesOpportunities({...pagination,status,type});return response(200,{opportunities:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status,type});}
  if(method==='POST'&&url==='/api/v1/ai/sales/scan'){if(!can(role,'ai:manage'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const limit=Number(body.limit??500);if(!Number.isInteger(limit)||limit<1||limit>2000)return response(400,{error:'invalid_sales_scan_limit'});return response(200,await scanSalesOpportunities(db,{actorUserId:context.userId,limit}));}
  const salesUpdateMatch=url.match(/^\/api\/v1\/ai\/sales\/opportunities\/([^/]+)$/);if(method==='PATCH'&&salesUpdateMatch){if(!can(role,'ai:sales'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const status=cleanOptional(body.status),assignedTo=body.assignedTo===null?'':cleanOptional(body.assignedTo),note=cleanLongText(body.note,1000);if(!['approved','contacted','converted','dismissed','lost'].includes(status)||(['converted','lost','dismissed'].includes(status)&&note.length<3))return response(400,{error:'invalid_sales_opportunity_update'});try{const opportunity=await updateSalesOpportunity(db,{opportunityId:salesUpdateMatch[1],status,assignedTo,note,actorUserId:context.userId});return opportunity?response(200,{opportunity}):response(404,{error:'sales_opportunity_not_found'});}catch(error){if(error.message.includes('Invalid sales'))return response(409,{error:'sales_opportunity_transition_conflict'});throw error;}}
  if(method==='GET'&&url==='/api/v1/ai/marketing/stats'){if(!can(role,'ai:read'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.marketingStats()});}
  if(method==='GET'&&url==='/api/v1/ai/marketing/recommendations'){if(!can(role,'marketing:read'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'active',type=context.type||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','active','new','approved','scheduled','completed','dismissed'].includes(status)||!['all','recovery_campaign','budget_shift','content_plan','attribution_fix','delivery_fix'].includes(type))return response(400,{error:'invalid_marketing_recommendation_filter'});const rows=await createRepositories(db).ai.marketingRecommendations({...pagination,status,type});return response(200,{recommendations:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status,type});}
  if(method==='POST'&&url==='/api/v1/ai/marketing/scan'){if(!can(role,'ai:marketing')||!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});return response(200,await scanMarketingRecommendations(db,{actorUserId:context.userId}));}
  const marketingUpdateMatch=url.match(/^\/api\/v1\/ai\/marketing\/recommendations\/([^/]+)$/);if(method==='PATCH'&&marketingUpdateMatch){if(!can(role,'ai:marketing')||!can(role,'marketing:update'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const status=cleanOptional(body.status),note=cleanLongText(body.note,1000);if(!['approved','scheduled','completed','dismissed'].includes(status)||(['completed','dismissed'].includes(status)&&note.length<3))return response(400,{error:'invalid_marketing_recommendation_update'});try{const recommendation=await updateMarketingRecommendation(db,{recommendationId:marketingUpdateMatch[1],status,note,actorUserId:context.userId});return recommendation?response(200,{recommendation}):response(404,{error:'marketing_recommendation_not_found'});}catch(error){if(error.message.includes('Invalid marketing'))return response(409,{error:'marketing_recommendation_transition_conflict'});throw error;}}
  if(method==='GET'&&url==='/api/v1/ai/finance/stats'){if(!can(role,'ai:finance'))return response(403,{error:'forbidden'});return response(200,{stats:await createRepositories(db).ai.financeStats()});}
  if(method==='GET'&&url==='/api/v1/ai/finance/anomalies'){if(!can(role,'ai:finance'))return response(403,{error:'forbidden'});const pagination=parsePagination(context),status=context.status||'active',type=context.type||'all';if(!pagination)return response(400,{error:'invalid_pagination'});if(!['all','active','open','reviewed','resolved','dismissed'].includes(status)||!['all','negative_margin','revenue_drop','settlement_backlog','overdue_purchase'].includes(type))return response(400,{error:'invalid_finance_anomaly_filter'});const rows=await createRepositories(db).ai.financeAnomalies({...pagination,status,type});return response(200,{anomalies:rows.map(({total_count,...item})=>item),pagination:{...pagination,total:rows[0]?.total_count||0},status,type});}
  if(method==='POST'&&url==='/api/v1/ai/finance/scan'){if(!can(role,'ai:finance'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});return response(200,await scanFinanceAnomalies(db,{actorUserId:context.userId}));}
  const financeUpdateMatch=url.match(/^\/api\/v1\/ai\/finance\/anomalies\/([^/]+)$/);if(method==='PATCH'&&financeUpdateMatch){if(!can(role,'ai:finance'))return response(403,{error:'forbidden'});if(!context.userId)return response(401,{error:'user_identity_required'});const status=cleanOptional(body.status),note=cleanLongText(body.note,1000);if(!['reviewed','resolved','dismissed'].includes(status)||(['resolved','dismissed'].includes(status)&&note.length<3))return response(400,{error:'invalid_finance_anomaly_update'});try{const anomaly=await updateFinanceAnomaly(db,{anomalyId:financeUpdateMatch[1],status,note,actorUserId:context.userId});return anomaly?response(200,{anomaly}):response(404,{error:'finance_anomaly_not_found'});}catch(error){if(error.message.includes('Invalid finance'))return response(409,{error:'finance_anomaly_transition_conflict'});throw error;}}

  if (method === 'GET' && url === '/api/v1/settlements') {
    if (!can(role, 'settlements:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'pending_approval', 'approved', 'rejected', 'paid'].includes(status)) return response(400, { error: 'invalid_settlement_status_filter' });
    const rows = await createRepositories(db).settlements.listForOperations({
      ...pagination, status, query: context.query || '', tenantId: context.tenantId||null
    });
    return response(200, {
      settlements: rows.map(({ total_count, ...settlement }) => settlement),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/inventory/stats') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).inventory.stats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/stats') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    return response(200, { stats: await createRepositories(db).purchasing.stats() });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/suppliers') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const rows = await createRepositories(db).purchasing.suppliers({ ...pagination, query: context.query || '' });
    return response(200, { suppliers: rows.map(({ total_count, ...supplier }) => supplier), pagination: { ...pagination, total: rows[0]?.total_count || 0 } });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/orders') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context), status = context.status || 'all';
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    if (!['all','draft','approved','partially_received','received','cancelled','overdue'].includes(status)) return response(400, { error: 'invalid_purchase_order_status' });
    const rows = await createRepositories(db).purchasing.list({ ...pagination, status, query: context.query || '' });
    return response(200, { orders: rows.map(({ total_count, ...order }) => order), pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status });
  }

  if (method === 'POST' && url === '/api/v1/purchasing/suppliers') {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const name = cleanOptional(body.name), contactName = cleanOptional(body.contactName), mobile = cleanOptional(body.mobile), email = cleanOptional(body.email), vatNumber = cleanOptional(body.vatNumber);
    if (name.length < 2 || name.length > 200 || contactName.length > 200 || mobile.length > 30 || email.length > 200 || vatNumber.length > 30) return response(400, { error: 'invalid_supplier' });
    try { return response(201, { supplier: await createSupplier(db, { name, contactName, mobile, email, vatNumber, actorUserId: context.userId }) }); }
    catch (error) { if (error.code === '23505') return response(409, { error: 'supplier_exists' }); throw error; }
  }

  if (method === 'POST' && url === '/api/v1/purchasing/orders') {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const poNumber = cleanOptional(body.poNumber).toUpperCase(), supplierId = cleanOptional(body.supplierId), warehouseId = cleanOptional(body.warehouseId), notes = cleanOptional(body.notes);
    const expectedAt = body.expectedAt ? parseDate(body.expectedAt) : null, items = Array.isArray(body.items) ? body.items.map(item => ({ itemId: cleanOptional(item.itemId), quantity: Number(item.quantity), unitCost: Number(item.unitCost) })) : [];
    if (poNumber.length < 2 || poNumber.length > 80 || !supplierId || !warehouseId || (body.expectedAt && !expectedAt) || notes.length > 1000 || items.length < 1 || items.length > 100 || new Set(items.map(item=>item.itemId)).size !== items.length || items.some(item=>!item.itemId || !validInventoryNumber(item.quantity, false) || !validInventoryNumber(item.unitCost, true))) return response(400, { error: 'invalid_purchase_order' });
    try { return response(201, await createPurchaseOrder(db, { poNumber, supplierId, warehouseId, expectedAt, notes, items, actorUserId: context.userId })); }
    catch (error) { if (error.code === '23505') return response(409, { error: 'purchase_order_exists' }); if (error.message.includes('not found')) return response(404, { error: 'purchasing_target_not_found' }); throw error; }
  }

  const purchaseActionMatch = url.match(/^\/api\/v1\/purchasing\/orders\/([^/]+)\/(approve|receive)$/);
  if (method === 'POST' && purchaseActionMatch) {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    try {
      if (purchaseActionMatch[2] === 'approve') {
        const order = await approvePurchaseOrder(db, { purchaseOrderId: purchaseActionMatch[1], actorUserId: context.userId });
        return order ? response(200, { order }) : response(404, { error: 'purchase_order_not_found' });
      }
      const lines = Array.isArray(body.lines) ? body.lines.map(line => ({ purchaseOrderItemId: cleanOptional(line.purchaseOrderItemId), quantity: Number(line.quantity) })) : [];
      const notes = cleanOptional(body.notes);
      if (!lines.length || lines.length > 100 || notes.length > 500 || new Set(lines.map(line=>line.purchaseOrderItemId)).size !== lines.length || lines.some(line=>!line.purchaseOrderItemId || !validInventoryNumber(line.quantity, false))) return response(400, { error: 'invalid_purchase_receipt' });
      const order = await receivePurchaseOrder(db, { purchaseOrderId: purchaseActionMatch[1], lines, notes, actorUserId: context.userId });
      return order ? response(200, { order }) : response(404, { error: 'purchase_order_not_found' });
    } catch (error) {
      if (error.message.includes('not approvable') || error.message.includes('not receivable') || error.message.includes('over-receipt')) return response(409, { error: 'purchase_order_conflict', message: error.message });
      if (error.message.includes('Invalid purchase')) return response(400, { error: 'invalid_purchase_receipt' });
      throw error;
    }
  }

  if (method === 'GET' && url === '/api/v1/inventory') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'low', 'out'].includes(status)) return response(400, { error: 'invalid_inventory_status_filter' });
    const rows = await createRepositories(db).inventory.list({ ...pagination, status, query: context.query || '' });
    return response(200, {
      items: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/inventory/movements') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const rows = await createRepositories(db).inventory.movements(pagination);
    return response(200, {
      movements: rows.map(({ total_count, ...movement }) => movement),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }

  const technicianInventoryMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/inventory$/);
  if (method === 'GET' && technicianInventoryMatch) {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const stock = await createRepositories(db).inventory.technicianStock(technicianInventoryMatch[1]);
    return response(200, { technicianId: technicianInventoryMatch[1], stock });
  }

  if (method === 'POST' && url === '/api/v1/inventory/items') {
    if (!can(role, 'inventory:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const sku = cleanOptional(body.sku).toUpperCase(), name = cleanOptional(body.name), unit = cleanOptional(body.unit) || 'piece';
    const reorderLevel = Number(body.reorderLevel ?? 0), unitCost = Number(body.unitCost ?? 0);
    if (sku.length < 2 || sku.length > 80 || name.length < 2 || name.length > 200 || unit.length > 40 ||
        !validInventoryNumber(reorderLevel, true) || !validInventoryNumber(unitCost, true)) return response(400, { error: 'invalid_inventory_item' });
    try {
      const item = await createInventoryItem(db, { sku, name, unit, reorderLevel, unitCost, actorUserId: context.userId });
      return response(201, { item });
    } catch (error) {
      if (error.code === '23505') return response(409, { error: 'inventory_sku_exists' });
      throw error;
    }
  }

  if (method === 'POST' && ['/api/v1/inventory/receive','/api/v1/inventory/transfer','/api/v1/inventory/technician-issue'].includes(url)) {
    if (!can(role, 'inventory:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const itemId = cleanOptional(body.itemId), quantity = Number(body.quantity), reference = cleanOptional(body.reference), notes = cleanOptional(body.notes);
    if (!itemId || !validInventoryNumber(quantity, false) || reference.length > 200 || notes.length > 500) return response(400, { error: 'invalid_inventory_movement' });
    try {
      if (url.endsWith('/receive')) {
        const warehouseId = cleanOptional(body.warehouseId), unitCost = body.unitCost === undefined || body.unitCost === '' ? null : Number(body.unitCost);
        if (!warehouseId || (unitCost !== null && !validInventoryNumber(unitCost, true))) return response(400, { error: 'invalid_inventory_movement' });
        return response(201, await receiveInventory(db, { warehouseId, itemId, quantity, unitCost, reference, notes, actorUserId: context.userId }));
      }
      if (url.endsWith('/transfer')) {
        const fromWarehouseId = cleanOptional(body.fromWarehouseId), toWarehouseId = cleanOptional(body.toWarehouseId);
        if (!fromWarehouseId || !toWarehouseId) return response(400, { error: 'invalid_inventory_movement' });
        return response(201, await transferInventory(db, { fromWarehouseId, toWarehouseId, itemId, quantity, reference, notes, actorUserId: context.userId }));
      }
      const warehouseId = cleanOptional(body.warehouseId), technicianId = cleanOptional(body.technicianId);
      if (!warehouseId || !technicianId) return response(400, { error: 'invalid_inventory_movement' });
      return response(201, await issueInventoryToTechnician(db, { warehouseId, technicianId, itemId, quantity, reference, notes, actorUserId: context.userId }));
    } catch (error) {
      if (error.message.includes('not found')) return response(404, { error: 'inventory_target_not_found' });
      if (error.message.includes('Insufficient') || error.message.includes('different')) return response(409, { error: 'inventory_movement_conflict', message: error.message });
      throw error;
    }
  }

  const technicianPerformanceMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/performance$/);
  if (method === 'GET' && technicianPerformanceMatch) {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const range = parseDateRange(context.from, context.to);
    if (!range) return response(400, { error: 'invalid_date_range' });
    const repos = createRepositories(db);
    const technician = await repos.technicians.performance(technicianPerformanceMatch[1],range.from,range.to,context.tenantId||null);
    if (!technician) return response(404, { error: 'technician_not_found' });
    const recentJobs = await repos.technicians.recentJobs(technicianPerformanceMatch[1], range.from, range.to, 10);
    return response(200, { technician, recentJobs, range });
  }

  const technicianStatusMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/status$/);
  if (method === 'PATCH' && technicianStatusMatch) {
    if (!can(role, 'technicians:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    if (typeof body.isActive !== 'boolean') return response(400, { error: 'invalid_technician_status' });
    const reason = cleanOptional(body.reason);
    if (!body.isActive && reason.length < 3) return response(400, { error: 'deactivation_reason_required' });
    try {
      const technician = await setTechnicianActive(db, {
        technicianId:technicianStatusMatch[1],isActive:body.isActive,reason,actorUserId:context.userId,tenantId:context.tenantId||null
      });
      return technician ? response(200, { technician }) : response(404, { error: 'technician_not_found' });
    } catch (error) {
      if (error.message === 'Technician status is unchanged') return response(409, { error: 'technician_status_unchanged' });
      throw error;
    }
  }

  const candidatesMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/candidates$/);
  if (method === 'GET' && candidatesMatch) {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    const limit = context.limit === undefined ? 10 : Number(context.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return response(400, { error: 'invalid_pagination' });
    try {
      const result = await listDispatchCandidates(db, candidatesMatch[1], {
        windowStart: context.from, windowEnd: context.to, limit, tenantId: context.tenantId||null
      });
      return response(200, result);
    } catch (error) {
      if (error.message === 'Service job not found') return response(404, { error: 'job_not_found' });
      if (error.message === 'Service job is not dispatchable') return response(409, { error: 'job_not_dispatchable' });
      throw error;
    }
  }

  const dispatchMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/(assign|reassign)$/);
  if (method === 'POST' && dispatchMatch) {
    if (!can(role, 'jobs:assign') || !can(role, 'jobs:schedule')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const technicianId = cleanOptional(body.technicianId);
    const scheduledAt = parseDate(body.scheduledAt);
    const serviceDurationMinutes = Number(body.serviceDurationMinutes ?? 60);
    const reason = cleanOptional(body.reason);
    if (!technicianId || !scheduledAt || !Number.isInteger(serviceDurationMinutes) || serviceDurationMinutes < 1 || serviceDurationMinutes > 1440 ||
        (dispatchMatch[2] === 'reassign' && reason.length < 3)) {
      return response(400, { error: 'invalid_assignment' });
    }
    try {
      const input = { jobId: dispatchMatch[1], technicianId, scheduledAt, serviceDurationMinutes, actorUserId: context.userId, tenantId: context.tenantId||null };
      const job = dispatchMatch[2] === 'assign'
        ? await assignPersistentJob(db, input)
        : await reassignPersistentJob(db, { ...input, reason });
      return response(200, { job });
    } catch (error) {
      if (error.message === 'Service job not found') return response(404, { error: 'job_not_found' });
      if (error.message.includes('already assigned') || error.message.includes('Only scheduled jobs')) return response(409, { error: 'job_not_assignable' });
      if (error.message.includes('scheduling conflict')) return response(409, { error: 'schedule_conflict' });
      if (error.message.includes('eligible') || error.message.includes('skill') || error.message.includes('unavailable') || error.message.includes('scheduled time')) {
        return response(422, { error: 'assignment_invalid', message: error.message });
      }
      throw error;
    }
  }

  const customerMatch = url.match(/^\/api\/v1\/customers\/([^/]+)$/);
  const timelineMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const customer = await repos.customers.findDetails(timelineMatch[1],context.tenantId||null);
    if (!customer) return response(404, { error: 'customer_not_found' });
    const rows = await repos.customers.timeline(timelineMatch[1], pagination);
    return response(200, {
      customerId: timelineMatch[1],
      timeline: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const collectionMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/(addresses|assets|orders|jobs)$/);
  if (method === 'GET' && collectionMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const customer = await repos.customers.findDetails(collectionMatch[1],context.tenantId||null);
    if (!customer) return response(404, { error: 'customer_not_found' });
    const key = collectionMatch[2];
    const loaders = {
      addresses: repos.customers.listAddresses,
      assets: repos.customers.listAssets,
      orders: repos.customers.listOrders,
      jobs: repos.customers.listServiceJobs
    };
    const rows = await loaders[key](collectionMatch[1], pagination);
    return response(200, {
      customerId: collectionMatch[1],
      [key]: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const assetHistoryMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)\/history$/);
  if (method === 'GET' && assetHistoryMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const asset = await repos.customers.findAsset(assetHistoryMatch[1],assetHistoryMatch[2],context.tenantId||null);
    if (!asset) return response(404, { error: 'asset_not_found' });
    const rows = await repos.customers.listAssetHistory(assetHistoryMatch[1], assetHistoryMatch[2], pagination);
    return response(200, {
      customerId: assetHistoryMatch[1], assetId: assetHistoryMatch[2],
      maintenance: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const addressMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/addresses$/);
  if (method === 'POST' && addressMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const cityId = cleanOptional(body.cityId);
    const addressText = cleanOptional(body.addressText);
    if (!cityId || cityId.length > 100 || addressText.length < 3) return response(400, { error: 'invalid_address' });
    const address = await createRepositories(db).customers.addAddress(addressMatch[1],{cityId,addressText},context.tenantId||null);
    return address ? response(201, { address }) : response(404, { error: 'customer_not_found' });
  }
  const assetMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets$/);
  if (method === 'POST' && assetMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const productId = cleanOptional(body.productId);
    const serialNumber = cleanOptional(body.serialNumber) || null;
    const installedAt = parseDate(body.installedAt);
    const warrantyEndsAt = body.warrantyEndsAt ? parseDate(body.warrantyEndsAt) : null;
    const maintenanceIntervalMonths = Number(body.maintenanceIntervalMonths ?? 6);
    if (productId.length < 2 || productId.length > 200 || (serialNumber && serialNumber.length > 100) ||
        !installedAt || (body.warrantyEndsAt && !warrantyEndsAt) ||
        !Number.isInteger(maintenanceIntervalMonths) || maintenanceIntervalMonths < 1 || maintenanceIntervalMonths > 120 ||
        (warrantyEndsAt && warrantyEndsAt < installedAt)) {
      return response(400, { error: 'invalid_asset' });
    }
    const asset = await createRepositories(db).customers.addAsset(assetMatch[1], {
      productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths,
      nextMaintenanceAt: addUtcMonths(installedAt, maintenanceIntervalMonths)
    },context.tenantId||null);
    return asset ? response(201, { asset }) : response(404, { error: 'customer_not_found' });
  }
  const maintenanceMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)\/maintenance$/);
  if (method === 'POST' && maintenanceMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const completedAt = parseDate(body.completedAt);
    const notes = cleanOptional(body.notes);
    if (!completedAt || notes.length > 500) return response(400, { error: 'invalid_maintenance' });
    const ownedAsset=await createRepositories(db).customers.findAsset(maintenanceMatch[1],maintenanceMatch[2],context.tenantId||null);
    if(!ownedAsset)return response(404,{error:'asset_not_found'});
    try {
      const result = await completeAssetMaintenance(db, {
        customerId: maintenanceMatch[1], assetId: maintenanceMatch[2],
        actorUserId: context.userId, completedAt, notes
      });
      return result ? response(200, result) : response(404, { error: 'asset_not_found' });
    } catch (error) {
      if (error.message === 'Asset is not active') return response(409, { error: 'asset_not_active' });
      throw error;
    }
  }
  const assetStatusMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)$/);
  if (method === 'PATCH' && assetStatusMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    if (!['active', 'inactive'].includes(body.status)) return response(400, { error: 'invalid_asset_status' });
    const ownedAsset=await createRepositories(db).customers.findAsset(assetStatusMatch[1],assetStatusMatch[2],context.tenantId||null);
    if(!ownedAsset)return response(404,{error:'asset_not_found'});
    try {
      const asset = await updateAssetStatus(db, {
        customerId: assetStatusMatch[1], assetId: assetStatusMatch[2], actorUserId: context.userId, status: body.status
      });
      return asset ? response(200, { asset }) : response(404, { error: 'asset_not_found' });
    } catch (error) {
      if (error.message === 'Retired asset cannot change status') return response(409, { error: 'asset_retired' });
      throw error;
    }
  }
  if (method === 'PATCH' && customerMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const hasName = Object.hasOwn(body, 'name');
    const hasMobile = Object.hasOwn(body, 'mobile');
    const name = hasName && typeof body.name === 'string' ? body.name.trim() : null;
    const mobile = hasMobile ? normalizeSaudiMobile(body.mobile) : null;
    if ((!hasName && !hasMobile) || (hasName && (!name || name.length < 2)) || (hasMobile && !mobile)) {
      return response(400, { error: 'invalid_customer_update' });
    }
    try {
      const customer = await createRepositories(db).customers.update(customerMatch[1],{name,mobile},context.tenantId||null);
      return customer ? response(200, { customer }) : response(404, { error: 'customer_not_found' });
    } catch (error) {
      if (error.message === 'Customer mobile already exists') return response(409, { error: 'mobile_already_exists' });
      throw error;
    }
  }
  if (method === 'GET' && customerMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const customer = await createRepositories(db).customers.findDetails(customerMatch[1],context.tenantId||null);
    return customer ? response(200, { customer }) : response(404, { error: 'customer_not_found' });
  }

  const approveMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });

    try {
      const result = await approveSettlementAndCreditWallet(db, {
        settlementId: approveMatch[1],
        approverUserId: context.userId,
        tenantId: context.tenantId||null
      });
      return response(200, result);
    } catch (error) {
      if (error.message === 'Settlement not found') return response(404, { error: 'settlement_not_found' });
      if (error.message === 'Settlement is not approvable') return response(409, { error: 'settlement_not_approvable' });
      throw error;
    }
  }

  const rejectMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const reason = cleanOptional(body.reason);
    if (reason.length < 3) return response(400, { error: 'rejection_reason_required' });
    try {
      const settlement = await rejectSettlement(db, { settlementId: rejectMatch[1], reason, actorUserId: context.userId, tenantId: context.tenantId||null });
      return settlement ? response(200, { settlement }) : response(404, { error: 'settlement_not_found' });
    } catch (error) {
      if (error.message === 'Settlement is not rejectable') return response(409, { error: 'settlement_not_rejectable' });
      throw error;
    }
  }

  const paidMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/paid$/);
  if (method === 'POST' && paidMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const paymentReference = cleanOptional(body.paymentReference);
    if (paymentReference.length < 3) return response(400, { error: 'payment_reference_required' });
    try {
      const settlement = await markSettlementPaid(db, { settlementId: paidMatch[1], paymentReference, actorUserId: context.userId, tenantId: context.tenantId||null });
      return settlement ? response(200, { settlement }) : response(404, { error: 'settlement_not_found' });
    } catch (error) {
      if (error.message === 'Settlement is not payable') return response(409, { error: 'settlement_not_payable' });
      throw error;
    }
  }

  const completeMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)\/complete$/);
  if (method === 'POST' && completeMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    try {
      const result = await completeTechnicianJob(db, {
        jobId: completeMatch[1],
        technicianId: identity.technician.id,
        actorUserId: context.userId,
        evidence: body.evidence
      });
      if (!result) return response(404, { error: 'job_not_found' });
      return response(200, result);
    } catch (error) {
      const completionErrors = {
        'Evidence is required before completion': 'evidence_required',
        'Too many evidence items': 'too_many_evidence_items',
        'Invalid evidence': 'invalid_evidence',
        'Duplicate evidence': 'duplicate_evidence',
        'Job must be in progress': 'job_not_in_progress',
        'Completion finance configuration missing': 'finance_configuration_missing'
      };
      const code = completionErrors[error.message];
      if (code) return response(422, { error: code });
      throw error;
    }
  }

  const statusMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;
    if (typeof body.status !== 'string') return response(400, { error: 'status_required' });

    try {
      const job = await transitionTechnicianJob(db, {
        jobId: statusMatch[1],
        technicianId: identity.technician.id,
        actorUserId: context.userId,
        toStatus: body.status
      });
      if (!job) return response(404, { error: 'job_not_found' });
      return response(200, { job });
    } catch (error) {
      if (error.message === 'Completion requires evidence endpoint') {
        return response(409, { error: 'completion_endpoint_required' });
      }
      if (error.message.startsWith('Invalid transition:')) {
        return response(409, { error: 'invalid_transition', message: error.message });
      }
      throw error;
    }
  }

  const jobDetailsMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobDetailsMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const job = await identity.repos.jobs.findForTechnician(jobDetailsMatch[1], identity.technician.id);
    if (!job) return response(404, { error: 'job_not_found' });
    return response(200, { technicianId: identity.technician.id, job });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/jobs') {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const from = context.from || startOfUtcDay(new Date());
    const to = context.to || addUtcDays(from, 1);
    const jobs = await identity.repos.jobs.listForTechnician(identity.technician.id, from, to);
    return response(200, { technicianId: identity.technician.id, from, to, jobs });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/wallet') {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const [balance, entries] = await Promise.all([
      identity.repos.wallet.balance(identity.technician.id),
      identity.repos.wallet.listForTechnician(identity.technician.id, pagination)
    ]);
    return response(200, {
      technicianId: identity.technician.id,
      balance,
      currency: entries[0]?.currency || 'SAR',
      entries: entries.map(({ total_count, ...entry }) => entry),
      pagination: { ...pagination, total: entries[0]?.total_count || 0 }
    });
  }

  return response(404, { error: 'not_found' });
}

function parsePagination(context) {
  const limit = context.limit === undefined ? 20 : Number(context.limit);
  const offset = context.offset === undefined ? 0 : Number(context.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;
  return { limit, offset };
}

function normalizeSaudiMobile(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

function cleanOptional(value) { return typeof value === 'string' ? value.trim().slice(0, 500) : ''; }
function cleanLongText(value,max) { return typeof value === 'string' ? value.trim().slice(0,max) : ''; }

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDateRange(fromValue, toValue) {
  const to = toValue ? parseDate(toValue) : new Date().toISOString();
  const from = fromValue ? parseDate(fromValue) : new Date(Date.now() - 30 * 86400000).toISOString();
  if (!from || !to || from >= to) return null;
  const maximumRange = 366 * 86400000;
  if (new Date(to).getTime() - new Date(from).getTime() > maximumRange) return null;
  return { from, to };
}

function validInventoryNumber(value, allowZero) {
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 1_000_000;
}

function validSegmentType(value){return ['all','repeat_customers','dormant_90d','maintenance_due_30d','high_value'].includes(value);}
function validContentStatus(value,allowAll=true){return(allowAll?['all']:[]).concat(['idea','draft','review','approved','scheduled','published','cancelled']).includes(value);}
function validContentChannel(value,allowAll=true){return(allowAll?['all']:[]).concat(['website','instagram','x','snapchat','tiktok','email']).includes(value);}

function addUtcMonths(iso, months) {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

async function resolveTechnician({ role, context, db }) {
  if (!can(role, 'jobs:assigned:read') || role !== 'technician') {
    return { error: response(403, { error: 'forbidden' }) };
  }
  if (!context.userId) return { error: response(401, { error: 'user_identity_required' }) };

  const repos = createRepositories(db);
  const technician = await repos.technicians.findActiveByUserId(context.userId,context.tenantId||null);
  if (!technician) return { error: response(403, { error: 'active_technician_required' }) };
  return { repos, technician };
}

async function resolveCustomer({role,context,db}){
  if(role!=='customer'||!can(role,'customer:self:read'))return{error:response(403,{error:'forbidden'})};
  if(!context.userId)return{error:response(401,{error:'user_identity_required'})};
  const repos=createRepositories(db),customer=await repos.customers.findByUserId(context.userId,context.tenantId||null);
  if(!customer)return{error:response(403,{error:'customer_profile_required'})};
  return{repos,customer};
}

function startOfUtcDay(date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString();
}

function addUtcDays(iso, days) {
  const value = new Date(iso);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function response(status, data) { return { status, data }; }

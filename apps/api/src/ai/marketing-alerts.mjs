import{createWooCommerceCatalogClient}from'../integrations/woocommerce-catalog.mjs';
import{createSubilCommerceAnalyticsClient}from'../integrations/subil-commerce-analytics.mjs';
import{withTransaction}from'../persistence/transactions.mjs';
const DEFAULT_ORG='00000000-0000-4000-8000-000000000001';

export async function scanMarketingAlerts(db,{actorUserId=null,organizationId=DEFAULT_ORG,date=new Date().toISOString().slice(0,10)}={}){
 const woo=createWooCommerceCatalogClient(),commerce=createSubilCommerceAnalyticsClient();
 let store=null,commerceData=null;
 if(woo.configured){try{store=await woo.getStoreIntelligence()}catch{}}
 if(commerce.configured){try{commerceData=await commerce.getAnalytics()}catch{}}
 return withTransaction(db,async c=>{
  const rev=(await c.query(`SELECT COUNT(*)::integer AS orders,COALESCE(AVG(total_ex_vat),0)::numeric(14,2) AS aov FROM orders WHERE paid_at>=now()-interval '90 days'`)).rows[0]||{};
  const attributed=(await c.query(`SELECT COUNT(DISTINCT oa.order_id)::integer AS attributed FROM order_attribution oa JOIN orders o ON o.id=oa.order_id WHERE o.paid_at>=now()-interval '90 days'`)).rows[0]||{};
  const alerts=[];
  const aov=Number(rev.aov||0),orders=Number(rev.orders||0),coverage=orders?Number(attributed.attributed||0)/orders*100:100;
  if(aov>0&&aov<300)alerts.push({fingerprint:'marketing_aov_low',severity:'medium',title:'متوسط قيمة الطلب منخفض',summary:`متوسط قيمة الطلب ${aov.toFixed(0)} ر.س خلال آخر 90 يومًا.`,action:'وسّع Cross-sell وUpsell على المنتجات الأعلى زيارة وراقب multi-item AOV.',metrics:{aov}});
  if(orders>=5&&coverage<70)alerts.push({fingerprint:'marketing_attribution_gap',severity:'high',title:'فجوة في الإسناد التسويقي',summary:`تم إسناد ${coverage.toFixed(1)}% فقط من الطلبات المدفوعة إلى مصدر تسويقي.`,action:'راجع UTM وWooCommerce Order Attribution وتأكد من وصول بيانات المصدر مع كل طلب مدفوع.',metrics:{orders,coverage}});
  const seoHigh=Number(store?.products?.seo?.highPriority||0);
  if(seoHigh>0)alerts.push({fingerprint:'marketing_seo_backlog',severity:seoHigh>=5?'high':'medium',title:'فرص SEO عالية الأولوية',summary:`هناك ${seoHigh} منتجًا بأولوية SEO عالية.`,action:'نفّذ أعلى فرص SEO من القائمة ثم أعد الفحص لمراقبة الانخفاض في backlog.',metrics:{highPriority:seoHigh,needsWork:Number(store?.products?.seo?.needsWork||0)}});
  const atRisk=Number(store?.customers?.atRisk||0);
  if(atRisk>0)alerts.push({fingerprint:'marketing_customers_at_risk',severity:atRisk>=10?'high':'medium',title:'عملاء معرضون للفقد',summary:`تم رصد ${atRisk} عميلًا متكررًا دون طلب حديث خلال 90 يومًا.`,action:'جهّز رحلة Win-back للموافقين على التسويق واربطها بالصيانة أو المنتج التالي المناسب.',metrics:{atRisk,dormant:Number(store?.customers?.dormant90d||0)}});
  const warnings=commerceData?.dataQuality?.warnings||[];
  if(warnings.length)alerts.push({fingerprint:'marketing_data_quality',severity:'medium',title:'تحذير جودة بيانات المتجر',summary:`يوجد ${warnings.length} تحذير جودة في بيانات SUBIL Commerce.`,action:'استبعد القيم الشاذة من القرار حتى تصحيح المصدر وراجع الطلبات أو المنتجات المشار إليها.',metrics:{warnings,excludedProducts:commerceData?.dataQuality?.excludedProducts||[]}});
  const safeActions=[];
  if(store?.products?.seo?.opportunities?.length){
    const target=store.products.seo.opportunities.find(x=>Array.isArray(x.issues)&&x.issues.length>0);
    if(target&&woo.configured){
      try{
        const recent=(await c.query(`SELECT 1 FROM audit_log WHERE action='ai.autopilot_seo_apply' AND entity_type='woocommerce_product' AND entity_id=$1 AND created_at>=now()-interval '24 hours' LIMIT 1`,[String(target.id)])).rows[0];
        if(!recent){
          const result=await woo.applySafeSeoPatch(target.id);
          safeActions.push({type:'seo_apply',productId:target.id,changed:Boolean(result.changed),reason:'highest_seo_priority'});
          await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.autopilot_seo_apply','woocommerce_product',$2,$3::jsonb)`,[actorUserId,String(target.id),JSON.stringify({changed:Boolean(result.changed),issues:target.issues,scoreBefore:target.score,reason:'highest_seo_priority'})]);
        }
      }catch{}
    }
  }
  if(atRisk>0){
    try{
      const existing=(await c.query(`SELECT id FROM customer_segments WHERE organization_id=$1 AND segment_type='dormant_90d' AND is_active=true ORDER BY created_at DESC LIMIT 1`,[organizationId])).rows[0];
      let segmentId=existing?.id;
      if(!segmentId){
        segmentId=(await c.query(`INSERT INTO customer_segments(organization_id,name,segment_type,created_by)VALUES($1,'Win-back 90 يوم','dormant_90d',$2)RETURNING id`,[organizationId,actorUserId])).rows[0].id;
      }
      const recent=(await c.query(`SELECT id FROM marketing_campaigns WHERE organization_id=$1 AND segment_id=$2 AND name='Win-back 90 يوم' AND status IN('draft','scheduled','queued') ORDER BY created_at DESC LIMIT 1`,[organizationId,segmentId])).rows[0];
      if(!recent){
        const campaign=(await c.query(`INSERT INTO marketing_campaigns(organization_id,name,segment_id,channel,message,status,created_by)VALUES($1,'Win-back 90 يوم',$2,'whatsapp','مرحبًا، نود تذكيرك بخدمات الصيانة والمنتجات المناسبة لاستخدامك السابق لدى سبيل. يمكننا مساعدتك في اختيار الخطوة التالية المناسبة.','draft',$3)RETURNING id`,[organizationId,segmentId,actorUserId])).rows[0];
        safeActions.push({type:'winback_draft',campaignId:campaign.id,segmentId,reason:'customers_at_risk'});
        await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.autopilot_winback_draft','marketing_campaign',$2,$3::jsonb)`,[actorUserId,String(campaign.id),JSON.stringify({segmentId,atRisk,reason:'customers_at_risk'})]);
      }
    }catch{}
  }
  const rows=[];
  for(const a of alerts){
   rows.push((await c.query(`INSERT INTO ai_insights(organization_id,fingerprint,detected_on,domain,severity,title,summary,recommended_action,metrics)
    VALUES($1,$2,$3,'marketing',$4,$5,$6,$7,$8::jsonb)
    ON CONFLICT(organization_id,fingerprint,detected_on)DO UPDATE SET severity=EXCLUDED.severity,title=EXCLUDED.title,summary=EXCLUDED.summary,recommended_action=EXCLUDED.recommended_action,metrics=EXCLUDED.metrics,updated_at=now()
    RETURNING *`,[organizationId,a.fingerprint,date,a.severity,a.title,a.summary,a.action,JSON.stringify(a.metrics)])).rows[0]);
  }
  if(actorUserId)await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,'ai.marketing_alert_scan','ai_insight','batch',$2::jsonb)`,[actorUserId,JSON.stringify({count:rows.length,date})]);
  return{alerts:rows,safeActions,metrics:{aov,orders,coverage,seoHigh,atRisk,dataQualityWarnings:warnings.length}};
 });
}

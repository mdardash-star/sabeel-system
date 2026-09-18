function normalizeBase(v){return String(v||'').trim().replace(/\/$/,'');}

export function createSubilCommerceAnalyticsClient({
  baseUrl=process.env.WOOCOMMERCE_BASE_URL,
  fetchImpl=globalThis.fetch
}={}){
  const base=normalizeBase(baseUrl),configured=Boolean(base&&typeof fetchImpl==='function');
  return{
    configured,
    async getAnalytics(){
      if(!configured)throw new Error('Subil Commerce analytics unavailable');
      const r=await fetchImpl(`${base}/wp-json/subil-commerce/v1/analytics`,{headers:{accept:'application/json'}});
      if(!r.ok)throw new Error(`Subil Commerce analytics request failed: ${r.status}`);
      const raw=await r.json();
      return sanitizeAnalytics(raw);
    }
  };
}

export function sanitizeAnalytics(raw={}){
  const metrics=raw?.metrics||{},revenue=finite(metrics.revenue),orders=finite(metrics.orders),avgOrder=finite(metrics.avg_order);
  const warnings=[];
  if(orders>0&&avgOrder>0&&Math.abs(revenue/orders-avgOrder)>Math.max(5,avgOrder*.15))warnings.push('average_order_mismatch');
  const conversion=finite(metrics.conversion),checkoutReached=finite(metrics.checkout_reached);
  if(conversion>=99&&checkoutReached<20)warnings.push('conversion_sample_too_small');
  const topProducts=Array.isArray(raw?.top_products)?raw.top_products.map(p=>{
    const sales=finite(p.sales),views=finite(p.views),cartAdds=finite(p.cart_adds);
    const suspiciousSales=sales>Math.max(100000,revenue*10);
    if(suspiciousSales)warnings.push(`suspicious_product_sales:${p.id}`);
    return{id:String(p.id||''),name:String(p.name||''),views,cartAdds,sales:suspiciousSales?null:sales,suspiciousSales};
  }):[];
  return{
    metrics:{revenue,orders,avgOrder,checkoutReached,conversion},
    topProducts,
    dataQuality:{healthy:warnings.length===0,warnings:[...new Set(warnings)],excludedProducts:topProducts.filter(x=>x.suspiciousSales).map(x=>x.id)}
  };
}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:0;}

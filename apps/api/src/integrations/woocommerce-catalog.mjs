function normalizeBase(url){return String(url||'').trim().replace(/\/$/,'');}

export function createWooCommerceCatalogClient({baseUrl=process.env.WOOCOMMERCE_BASE_URL,consumerKey=process.env.WOOCOMMERCE_CONSUMER_KEY,consumerSecret=process.env.WOOCOMMERCE_CONSUMER_SECRET,fetchImpl=globalThis.fetch}={}){
  const base=normalizeBase(baseUrl);
  const configured=Boolean(base&&consumerKey&&consumerSecret&&typeof fetchImpl==='function');
  async function request(path,{method='GET',body}={}){
    if(!configured)throw new Error('WooCommerce catalog unavailable');
    const url=new URL(`${base}/wp-json/wc/v3${path}`);
    url.searchParams.set('consumer_key',consumerKey);
    url.searchParams.set('consumer_secret',consumerSecret);
    const response=await fetchImpl(url,{
      method,
      headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!response.ok)throw new Error(`WooCommerce catalog request failed: ${response.status}`);
    return response.json();
  }
  return {
    configured,
    async listProducts({page=1,perPage=24,search='',category=''}={}){
      const q=new URLSearchParams({status:'publish',page:String(page),per_page:String(perPage)});
      if(search)q.set('search',String(search));
      if(category)q.set('category',String(category));
      const rows=await request(`/products?${q.toString()}`);
      return rows.map(mapProduct);
    },
    async getProduct(id){return mapProduct(await request(`/products/${encodeURIComponent(id)}`));},
    async getRawProduct(id){return request(`/products/${encodeURIComponent(id)}`);},
    async suggestSeoPatch(id){
      const raw=await this.getRawProduct(id),product=mapProduct(raw),issues=[];
      if(product.name.length<18)issues.push('title_too_short');
      if(product.name.length>80)issues.push('title_too_long');
      if(!product.shortDescription||product.shortDescription.length<80)issues.push('short_description_weak');
      if(!product.imageAlt)issues.push('image_alt_missing');
      const category=product.categories?.[0]?.name||'منتجات المياه';
      const cleanName=product.name.replace(/\s+/g,' ').trim();
      const proposedName=cleanName.length<18?`${cleanName} – ${category}`:cleanName.length>80?cleanName.slice(0,77).trim()+'…':cleanName;
      const shortDescription=product.shortDescription&&product.shortDescription.length>=80?null:`<p><strong>${escapeHtml(proposedName)}</strong> من منتجات سبيل ضمن فئة ${escapeHtml(category)}. صُمم للاستخدام المناسب حسب مواصفات المنتج ونطاق التركيب، مع توفر خدمات الدعم والصيانة من سبيل.</p>`;
      return {product,issues,patch:{name:proposedName,...(shortDescription?{shortDescription}:{}),imageAlt:!product.imageAlt?proposedName:null}};
    },
    async applySafeSeoPatch(id){
      const suggestion=await this.suggestSeoPatch(id),safe={};
      if(suggestion.patch.name&&suggestion.patch.name!==suggestion.product.name)safe.name=suggestion.patch.name;
      if(suggestion.patch.shortDescription)safe.short_description=suggestion.patch.shortDescription;
      if(!Object.keys(safe).length)return {changed:false,product:suggestion.product,suggestion};
      const updated=await request(`/products/${encodeURIComponent(id)}`,{method:'PUT',body:safe});
      return {changed:true,product:mapProduct(updated),suggestion};
    },
    async updateProduct(id,patch={}){
      const safe={};
      if(typeof patch.name==='string'&&patch.name.trim())safe.name=patch.name.trim().slice(0,180);
      if(typeof patch.shortDescription==='string')safe.short_description=patch.shortDescription.slice(0,5000);
      if(typeof patch.description==='string')safe.description=patch.description.slice(0,30000);
      if(!Object.keys(safe).length)throw new Error('No safe product fields supplied');
      return mapProduct(await request(`/products/${encodeURIComponent(id)}`,{method:'PUT',body:safe}));
    },
    async listCategories(){const rows=await request('/products/categories?hide_empty=true&per_page=100');return rows.map(x=>({id:String(x.id),name:x.name,count:Number(x.count||0)}));},
    async listOrders({page=1,perPage=50,status='any',after=''}={}){
      const q=new URLSearchParams({page:String(page),per_page:String(perPage),orderby:'date',order:'desc'});
      if(status&&status!=='any')q.set('status',status);
      if(after)q.set('after',after);
      const rows=await request(`/orders?${q.toString()}`);
      return rows.map(mapOrder);
    },
    async listCustomers({page=1,perPage=50}={}){
      const q=new URLSearchParams({page:String(page),per_page:String(perPage),orderby:'registered_date',order:'desc'});
      const rows=await request(`/customers?${q.toString()}`);
      return rows.map(mapCustomer);
    },
    async getStoreIntelligence(){
      const [orders,customers,products]=await Promise.all([
        this.listOrders({perPage:50}),
        this.listCustomers({perPage:50}),
        this.listProducts({perPage:50})
      ]);
      const paid=orders.filter(o=>['processing','completed'].includes(o.status));
      const revenue=paid.reduce((sum,o)=>sum+o.total,0);
      const aov=paid.length?revenue/paid.length:0;
      const byCustomer=new Map();
      for(const o of paid){
        const key=o.customerId||o.email||o.phone||`guest-${o.id}`;
        const row=byCustomer.get(key)||{orders:0,revenue:0,lastOrderAt:null,name:o.name,email:o.email,phone:o.phone,customerId:o.customerId};
        row.orders+=1; row.revenue+=o.total; row.lastOrderAt=o.createdAt||row.lastOrderAt; byCustomer.set(key,row);
      }
      const customerRows=[...byCustomer.values()];
      const repeatCustomers=customerRows.filter(x=>x.orders>=2).length;
      const highValueCustomers=customerRows.filter(x=>x.revenue>=2000).length;
      const vipCustomers=customerRows.filter(x=>x.orders>=3||x.revenue>=3000).length;
      const recentCutoff=Date.now()-90*86400000;
      const dormantRows=customerRows.filter(x=>x.lastOrderAt&&new Date(x.lastOrderAt).getTime()<recentCutoff);
      const atRiskRows=customerRows.filter(x=>x.orders>=2&&x.lastOrderAt&&new Date(x.lastOrderAt).getTime()<recentCutoff);
      const topCustomers=[...customerRows].sort((a,b)=>b.revenue-a.revenue).slice(0,10);
      const topProducts=[...products].sort((a,b)=>(b.totalSales||0)-(a.totalSales||0)).slice(0,8);
      const pairMap=new Map();
      for(const order of paid){
        const ids=[...new Set((order.lineItems||[]).map(x=>x.productId).filter(Boolean))];
        for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
          const key=[ids[i],ids[j]].sort().join('|');
          pairMap.set(key,(pairMap.get(key)||0)+1);
        }
      }
      const productById=new Map(products.map(p=>[p.id,p]));
      const crossSellPairs=[...pairMap.entries()].map(([key,count])=>{
        const [a,b]=key.split('|');return {a:productById.get(a)||{id:a,name:a},b:productById.get(b)||{id:b,name:b},orders:count};
      }).sort((x,y)=>y.orders-x.orders).slice(0,10);
      const seoOpportunities=products.map(product=>{
        const issues=[];
        if(product.name.length<18)issues.push('title_too_short');
        if(product.name.length>80)issues.push('title_too_long');
        if(!product.shortDescription||product.shortDescription.length<80)issues.push('short_description_weak');
        if(!product.image)issues.push('image_missing');
        if(!product.imageAlt)issues.push('image_alt_missing');
        const score=Math.max(0,100-issues.length*20);
        return {id:product.id,name:product.name,score,issues,priority:issues.length>=3?'high':issues.length===2?'medium':issues.length===1?'low':'healthy'};
      }).sort((a,b)=>a.score-b.score);
      const seoSummary={
        scanned:products.length,
        needsWork:seoOpportunities.filter(x=>x.issues.length).length,
        highPriority:seoOpportunities.filter(x=>x.priority==='high').length,
        missingAlt:seoOpportunities.filter(x=>x.issues.includes('image_alt_missing')).length,
        weakDescription:seoOpportunities.filter(x=>x.issues.includes('short_description_weak')).length,
        opportunities:seoOpportunities.slice(0,20)
      };
      return {
        snapshotAt:new Date().toISOString(),
        orders:{sample:orders.length,paid:paid.length,revenue,aov},
        customers:{sample:customers.length,repeatCustomers,highValueCustomers,vipCustomers,dormant90d:dormantRows.length,atRisk:atRiskRows.length,topCustomers},
        products:{sample:products.length,topProducts,seo:seoSummary,crossSellPairs}
      };
    }
  };
}

function mapProduct(p){
  return {id:String(p.id),name:String(p.name||''),slug:String(p.slug||''),sku:String(p.sku||''),price:Number(p.price||0),regularPrice:Number(p.regular_price||0),salePrice:p.sale_price?Number(p.sale_price):null,onSale:Boolean(p.on_sale),stockStatus:String(p.stock_status||''),stockQuantity:p.stock_quantity==null?null:Number(p.stock_quantity),totalSales:Number(p.total_sales||0),image:p.images?.[0]?.src||null,imageAlt:String(p.images?.[0]?.alt||''),categories:Array.isArray(p.categories)?p.categories.map(c=>({id:String(c.id),name:c.name})):[],shortDescription:String(p.short_description||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()};
}

function mapOrder(o){
  return {id:String(o.id),status:String(o.status||''),total:Number(o.total||0),currency:String(o.currency||'SAR'),customerId:o.customer_id?String(o.customer_id):null,email:String(o.billing?.email||''),phone:String(o.billing?.phone||''),name:[o.billing?.first_name,o.billing?.last_name].filter(Boolean).join(' ').trim(),createdAt:o.date_created_gmt||o.date_created||null,lineItems:Array.isArray(o.line_items)?o.line_items.map(x=>({productId:String(x.product_id||''),name:x.name,quantity:Number(x.quantity||0),total:Number(x.total||0)})):[]};
}
function mapCustomer(x){
  return {id:String(x.id),email:String(x.email||''),firstName:String(x.first_name||''),lastName:String(x.last_name||''),name:[x.first_name,x.last_name].filter(Boolean).join(' ').trim(),ordersCount:Number(x.orders_count||0),totalSpent:Number(x.total_spent||0),lastOrderAt:x.date_modified_gmt||x.date_modified||null,billingPhone:String(x.billing?.phone||'')};
}

function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

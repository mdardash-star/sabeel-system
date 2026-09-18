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
        byCustomer.set(key,(byCustomer.get(key)||0)+1);
      }
      const repeatCustomers=[...byCustomer.values()].filter(n=>n>=2).length;
      const recentCutoff=Date.now()-90*86400000;
      const dormant=customers.filter(x=>x.lastOrderAt&&new Date(x.lastOrderAt).getTime()<recentCutoff).length;
      const topProducts=[...products].sort((a,b)=>(b.totalSales||0)-(a.totalSales||0)).slice(0,8);
      return {
        snapshotAt:new Date().toISOString(),
        orders:{sample:orders.length,paid:paid.length,revenue,aov},
        customers:{sample:customers.length,repeatCustomers,dormant90d:dormant},
        products:{sample:products.length,topProducts}
      };
    }
  };
}

function mapProduct(p){
  return {id:String(p.id),name:String(p.name||''),slug:String(p.slug||''),sku:String(p.sku||''),price:Number(p.price||0),regularPrice:Number(p.regular_price||0),salePrice:p.sale_price?Number(p.sale_price):null,onSale:Boolean(p.on_sale),stockStatus:String(p.stock_status||''),stockQuantity:p.stock_quantity==null?null:Number(p.stock_quantity),totalSales:Number(p.total_sales||0),image:p.images?.[0]?.src||null,categories:Array.isArray(p.categories)?p.categories.map(c=>({id:String(c.id),name:c.name})):[],shortDescription:String(p.short_description||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()};
}

function mapOrder(o){
  return {id:String(o.id),status:String(o.status||''),total:Number(o.total||0),currency:String(o.currency||'SAR'),customerId:o.customer_id?String(o.customer_id):null,email:String(o.billing?.email||''),phone:String(o.billing?.phone||''),name:[o.billing?.first_name,o.billing?.last_name].filter(Boolean).join(' ').trim(),createdAt:o.date_created_gmt||o.date_created||null,lineItems:Array.isArray(o.line_items)?o.line_items.map(x=>({productId:String(x.product_id||''),name:x.name,quantity:Number(x.quantity||0),total:Number(x.total||0)})):[]};
}
function mapCustomer(x){
  return {id:String(x.id),email:String(x.email||''),firstName:String(x.first_name||''),lastName:String(x.last_name||''),name:[x.first_name,x.last_name].filter(Boolean).join(' ').trim(),ordersCount:Number(x.orders_count||0),totalSpent:Number(x.total_spent||0),lastOrderAt:x.date_modified_gmt||x.date_modified||null,billingPhone:String(x.billing?.phone||'')};
}

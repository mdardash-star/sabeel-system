function normalizeBase(url){return String(url||'').trim().replace(/\/$/,'');}

export function createWooCommerceCatalogClient({baseUrl=process.env.WOOCOMMERCE_BASE_URL,consumerKey=process.env.WOOCOMMERCE_CONSUMER_KEY,consumerSecret=process.env.WOOCOMMERCE_CONSUMER_SECRET,fetchImpl=globalThis.fetch}={}){
  const base=normalizeBase(baseUrl);
  const configured=Boolean(base&&consumerKey&&consumerSecret&&typeof fetchImpl==='function');
  async function request(path){
    if(!configured)throw new Error('WooCommerce catalog unavailable');
    const url=new URL(`${base}/wp-json/wc/v3${path}`);
    url.searchParams.set('consumer_key',consumerKey);
    url.searchParams.set('consumer_secret',consumerSecret);
    const response=await fetchImpl(url,{headers:{accept:'application/json'}});
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
    async listCategories(){const rows=await request('/products/categories?hide_empty=true&per_page=100');return rows.map(x=>({id:String(x.id),name:x.name,count:Number(x.count||0)}));}
  };
}

function mapProduct(p){
  return {id:String(p.id),name:String(p.name||''),slug:String(p.slug||''),sku:String(p.sku||''),price:Number(p.price||0),regularPrice:Number(p.regular_price||0),salePrice:p.sale_price?Number(p.sale_price):null,onSale:Boolean(p.on_sale),stockStatus:String(p.stock_status||''),stockQuantity:p.stock_quantity==null?null:Number(p.stock_quantity),image:p.images?.[0]?.src||null,categories:Array.isArray(p.categories)?p.categories.map(c=>({id:String(c.id),name:c.name})):[],shortDescription:String(p.short_description||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()};
}

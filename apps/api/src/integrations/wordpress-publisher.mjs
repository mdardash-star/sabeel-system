function normalizeBase(v){return String(v||'').trim().replace(/\/$/,'');}
export function createWordPressPublisher({
 baseUrl=process.env.WORDPRESS_PUBLISH_URL||process.env.WOOCOMMERCE_BASE_URL,
 username=process.env.WORDPRESS_PUBLISH_USERNAME,
 appPassword=process.env.WORDPRESS_PUBLISH_APP_PASSWORD,
 fetchImpl=globalThis.fetch
}={}){
 const base=normalizeBase(baseUrl),configured=Boolean(base&&username&&appPassword&&typeof fetchImpl==='function');
 const auth=configured?'Basic '+Buffer.from(`${username}:${appPassword}`).toString('base64'):'';
 return{
  configured,
  async checkConnection(){
   if(!configured)throw new Error('WordPress publisher unavailable');
   const r=await fetchImpl(`${base}/wp-json/wp/v2/users/me?context=edit`,{headers:{authorization:auth,accept:'application/json'}});
   if(!r.ok)throw new Error(`WordPress auth failed: ${r.status}`);
   const data=await r.json();
   return{id:String(data.id||''),name:String(data.name||'')};
  },
  async publishPost({title,slug,content,excerpt=''}) {
   if(!configured)throw new Error('WordPress publisher unavailable');
   const r=await fetchImpl(`${base}/wp-json/wp/v2/posts`,{method:'POST',headers:{authorization:auth,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({status:'publish',title,slug,content,excerpt})});
   const data=await r.json().catch(()=>({}));
   if(!r.ok){const e=new Error(data?.message||`WordPress publish failed: ${r.status}`);e.status=r.status;throw e;}
   return{id:String(data.id),link:String(data.link||''),slug:String(data.slug||slug),status:String(data.status||'publish')};
  }
 };
}

const adminUrl=(process.env.SUBIL_ADMIN_URL||'https://subil-admin.onrender.com').replace(/\/$/,'');
const apiUrl=(process.env.SUBIL_API_URL||'https://subil-api.onrender.com').replace(/\/$/,'');
const technicianUrl=(process.env.SUBIL_TECHNICIAN_URL||'https://subil-technician.onrender.com').replace(/\/$/,'');
const mobileUrl=(process.env.SUBIL_MOBILE_URL||'https://subil-mobile.onrender.com').replace(/\/$/,'');
const storeUrl=(process.env.SUBIL_STORE_URL||'https://subil.store').replace(/\/$/,'');

async function check(name,url,expected=[200]){
  const response=await fetch(url,{redirect:'follow'});
  if(!expected.includes(response.status))throw new Error(`${name} failed: ${response.status}`);
  console.log(`ok ${name} ${response.status}`);
}
await check('admin',adminUrl);
await check('technician',technicianUrl);
await check('mobile',mobileUrl);
await check('api-health',`${apiUrl}/health`);
await check('api-ready',`${apiUrl}/ready`);
await check('auth-protection',`${apiUrl}/api/v1/users`,[401]);
await check('woocommerce-store-api',`${storeUrl}/wp-json/wc/store/v1/products?per_page=1`);
console.log(JSON.stringify({ok:true,adminUrl,technicianUrl,mobileUrl,apiUrl,storeUrl}));

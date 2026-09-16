const adminUrl=(process.env.SUBIL_ADMIN_URL||'https://subil-admin.onrender.com').replace(/\/$/,'');
const apiUrl=(process.env.SUBIL_API_URL||'https://subil-api.onrender.com').replace(/\/$/,'');

async function check(name,url,expected=[200]){
  const response=await fetch(url,{redirect:'follow'});
  if(!expected.includes(response.status))throw new Error(`${name} failed: ${response.status}`);
  console.log(`ok ${name} ${response.status}`);
}

await check('admin',adminUrl,[200]);
await check('api-health',`${apiUrl}/health`,[200]);
await check('auth-protection',`${apiUrl}/api/v1/users`,[401]);
console.log(JSON.stringify({ok:true,adminUrl,apiUrl}));

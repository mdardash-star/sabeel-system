function normalizeUrl(v){return String(v||'').trim().replace(/\/$/,'');}

export function createMarketingChannelSender({
  whatsappUrl=process.env.WHATSAPP_SENDER_URL,
  whatsappApiKey=process.env.WHATSAPP_SENDER_API_KEY,
  emailUrl=process.env.EMAIL_SENDER_URL,
  emailApiKey=process.env.EMAIL_SENDER_API_KEY,
  fetchImpl=globalThis.fetch
}={}){
  const whatsappBase=normalizeUrl(whatsappUrl),emailBase=normalizeUrl(emailUrl);
  async function sendVia(base,apiKey,payload){
    if(!base||!apiKey||typeof fetchImpl!=='function')throw new Error('provider_unavailable');
    const r=await fetchImpl(base,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify(payload)});
    let data={};try{data=await r.json()}catch{}
    if(!r.ok){const e=new Error(data?.error||`provider_http_${r.status}`);e.status=r.status;throw e;}
    return {messageId:data?.messageId||data?.id||null,raw:data};
  }
  return {
    whatsappConfigured:Boolean(whatsappBase&&whatsappApiKey),
    emailConfigured:Boolean(emailBase&&emailApiKey),
    async sendWhatsApp({to,message,metadata={}}){return sendVia(whatsappBase,whatsappApiKey,{to,message,metadata});},
    async sendEmail({to,subject,message,metadata={}}){return sendVia(emailBase,emailApiKey,{to,subject,message,metadata});}
  };
}

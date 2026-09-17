const wooRequired=["WOO_CONSUMER_KEY","WOO_CONSUMER_SECRET"];
const providers=[
 {id:"tap",label:"تاب",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"amwal",label:"أموال",required:["AMWAL_API_KEY","AMWAL_SECRET_KEY","AMWAL_STORE_ID","AMWAL_WEBHOOK_PUBLIC_KEY",...wooRequired]},
 {id:"tabby",label:"تابي",required:["TABBY_SECRET_KEY","TABBY_MERCHANT_CODE","TABBY_WEBHOOK_HEADER_VALUE",...wooRequired]},
 {id:"tamara",label:"تمارا",required:["TAMARA_API_TOKEN","TAMARA_NOTIFICATION_TOKEN",...wooRequired]},
 {id:"apple_pay",label:"Apple Pay",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"mada",label:"مدى",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"cards",label:"البطاقات",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"stc_pay",label:"إس تي سي باي",required:["TAP_SECRET_KEY",...wooRequired]}
];

export async function register(){
 if(process.env.NEXT_RUNTIME!=="nodejs")return;
 const methods=providers.map(p=>{
   const missing=p.required.filter(key=>!Boolean(String(process.env[key]||"").trim()));
   return {id:p.id,label:p.label,status:missing.length===0?"ready":"needs_configuration",missing};
 });
 const readyCount=methods.filter(m=>m.status==="ready").length;
 console.log(JSON.stringify({event:"subil.payment_readiness",status:readyCount===methods.length?"ready":readyCount>0?"partial":"not_ready",ready_count:readyCount,total_count:methods.length,methods}));
}

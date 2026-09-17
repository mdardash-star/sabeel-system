function missingWoo(){const missing:string[]=[];if(!String(process.env.WOO_CONSUMER_KEY||process.env.WOOCOMMERCE_CONSUMER_KEY||"").trim())missing.push("WOO_CONSUMER_KEY|WOOCOMMERCE_CONSUMER_KEY");if(!String(process.env.WOO_CONSUMER_SECRET||process.env.WOOCOMMERCE_CONSUMER_SECRET||"").trim())missing.push("WOO_CONSUMER_SECRET|WOOCOMMERCE_CONSUMER_SECRET");return missing}
const providers=[
 {id:"tap",label:"تاب",required:["TAP_SECRET_KEY"]},
 {id:"amwal",label:"أموال",required:["AMWAL_API_KEY","AMWAL_SECRET_KEY","AMWAL_STORE_ID","AMWAL_WEBHOOK_PUBLIC_KEY"]},
 {id:"tabby",label:"تابي",required:["TABBY_SECRET_KEY","TABBY_MERCHANT_CODE","TABBY_WEBHOOK_HEADER_VALUE"]},
 {id:"tamara",label:"تمارا",required:["TAMARA_API_TOKEN","TAMARA_NOTIFICATION_TOKEN"]},
 {id:"apple_pay",label:"Apple Pay",required:["TAP_SECRET_KEY"]},
 {id:"mada",label:"مدى",required:["TAP_SECRET_KEY"]},
 {id:"cards",label:"البطاقات",required:["TAP_SECRET_KEY"]},
 {id:"stc_pay",label:"إس تي سي باي",required:["TAP_SECRET_KEY"]}
];

export async function register(){
 if(process.env.NEXT_RUNTIME!=="nodejs")return;
 const wooMissing=missingWoo();
 const methods=providers.map(p=>{
   const missing=[...p.required.filter(key=>!Boolean(String(process.env[key]||"").trim())),...wooMissing];
   return {id:p.id,label:p.label,status:missing.length===0?"ready":"needs_configuration",missing};
 });
 const readyCount=methods.filter(m=>m.status==="ready").length;
 console.log(JSON.stringify({event:"subil.payment_readiness",status:readyCount===methods.length?"ready":readyCount>0?"partial":"not_ready",ready_count:readyCount,total_count:methods.length,methods}));
}

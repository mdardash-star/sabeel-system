const wooRequired=["WOO_CONSUMER_KEY","WOO_CONSUMER_SECRET"];
const providers=[
 {id:"tap",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"amwal",required:["AMWAL_API_KEY","AMWAL_SECRET_KEY","AMWAL_STORE_ID","AMWAL_WEBHOOK_PUBLIC_KEY",...wooRequired]},
 {id:"tabby",required:["TABBY_SECRET_KEY","TABBY_MERCHANT_CODE","TABBY_WEBHOOK_HEADER_VALUE",...wooRequired]},
 {id:"tamara",required:["TAMARA_API_TOKEN","TAMARA_NOTIFICATION_TOKEN",...wooRequired]},
 {id:"apple_pay",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"mada",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"cards",required:["TAP_SECRET_KEY",...wooRequired]},
 {id:"stc_pay",required:["TAP_SECRET_KEY",...wooRequired]}
];
const methods=providers.map(p=>{
 const missing=p.required.filter(key=>!String(process.env[key]||"").trim());
 return {id:p.id,status:missing.length?"needs_configuration":"ready",missing};
});
const ready=methods.filter(x=>x.status==="ready").length;
console.log(JSON.stringify({event:"payment.readiness",status:ready===methods.length?"ready":ready>0?"partial":"not_ready",ready_count:ready,total_count:methods.length,methods}));

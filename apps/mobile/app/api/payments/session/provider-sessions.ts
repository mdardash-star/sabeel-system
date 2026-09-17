type Customer={name?:string;email?:string;phone?:string};
type Address={city?:string;address?:string;zip?:string};
type Item={title?:string;quantity?:number;unitPrice?:number;referenceId?:string;category?:string;imageUrl?:string;productUrl?:string};
export type ProviderSessionInput={provider:string;orderId:string;amount:number;currency:"SAR";customer?:Customer;shipping?:Address;items?:Item[];origin:string};

function jsonHeaders(extra:Record<string,string>={}){return {"content-type":"application/json","accept":"application/json",...extra}}
async function parse(response:Response){const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(String(data?.message||data?.error||`provider_http_${response.status}`));(error as Error & {status?:number}).status=response.status;throw error}return data}
function phoneParts(phone=""){const digits=phone.replace(/\D/g,"");if(digits.startsWith("966"))return {country_code:"966",number:digits.slice(3)};if(digits.startsWith("0"))return {country_code:"966",number:digits.slice(1)};return {country_code:"966",number:digits}}
function saPhone(phone=""){const digits=phone.replace(/\D/g,"");if(digits.startsWith("966"))return `+${digits}`;if(digits.startsWith("0"))return `+966${digits.slice(1)}`;if(digits.startsWith("5"))return `+966${digits}`;return phone}
function itemRows(items:Item[]|undefined,total:number){const rows=(items||[]).filter(x=>x&&Number(x.quantity)>0);if(rows.length)return rows;return [{title:"طلب سبيل",quantity:1,unitPrice:total,referenceId:"subil-order",category:"Water Services"}]}

async function createTapSession(input:ProviderSessionInput){
 const secret=String(process.env.TAP_SECRET_KEY||"").trim();
 if(!secret)throw new Error("payment_provider_not_configured");
 const sourceMap:Record<string,string>={tap:"src_all",mada:"src_sa.mada",cards:"src_card",stc_pay:"src_sa.stcpay",apple_pay:"src_apple_pay"};
 const phone=phoneParts(input.customer?.phone);
 const body:any={amount:input.amount,currency:input.currency,threeDSecure:true,save_card:false,customer_initiated:true,description:`SUBIL ${input.orderId}`,reference:{transaction:input.orderId,order:input.orderId},customer:{first_name:input.customer?.name||"عميل سبيل",email:input.customer?.email||"customer@subil.store",phone},source:{id:sourceMap[input.provider]||"src_all"},redirect:{url:`${input.origin}/payment-return?provider=${encodeURIComponent(input.provider)}&order=${encodeURIComponent(input.orderId)}`}};
 const merchant=String(process.env.TAP_MERCHANT_ID||"").trim();if(merchant)body.merchant={id:merchant};
 const response=await fetch("https://api.tap.company/v2/charges/",{method:"POST",headers:jsonHeaders({authorization:`Bearer ${secret}`}),body:JSON.stringify(body),cache:"no-store"});
 const data=await parse(response);return {provider:input.provider,providerReference:String(data?.id||""),checkoutUrl:String(data?.transaction?.url||""),status:String(data?.status||"initiated").toLowerCase(),raw:{id:data?.id,status:data?.status}};
}

async function createAmwalSession(input:ProviderSessionInput){
 const apiKey=String(process.env.AMWAL_API_KEY||"").trim();const secret=String(process.env.AMWAL_SECRET_KEY||"").trim();const storeId=String(process.env.AMWAL_STORE_ID||"").trim();
 if(!apiKey||!secret||!storeId)throw new Error("payment_provider_not_configured");
 const response=await fetch(`https://backend.sa.amwal.tech/payment_links/${encodeURIComponent(storeId)}/create`,{method:"POST",headers:jsonHeaders({authorization:secret,"x-amwal-key":apiKey}),body:JSON.stringify({amount:input.amount,phoneNumber:saPhone(input.customer?.phone||""),title:`طلب سبيل ${input.orderId}`,description:`SUBIL ${input.orderId}`,singleUse:true}),cache:"no-store"});
 const data=await parse(response);return {provider:"amwal",providerReference:String(data?.payment_link_id||data?.id||""),checkoutUrl:String(data?.url||""),status:String(data?.status||"created").toLowerCase(),raw:{payment_link_id:data?.payment_link_id,status:data?.status}};
}

async function createTabbySession(input:ProviderSessionInput){
 const secret=String(process.env.TABBY_SECRET_KEY||"").trim();const merchantCode=String(process.env.TABBY_MERCHANT_CODE||"").trim();if(!secret||!merchantCode)throw new Error("payment_provider_not_configured");
 const rows=itemRows(input.items,input.amount).map((x,i)=>({title:x.title||`منتج ${i+1}`,quantity:Number(x.quantity||1),unit_price:Number(x.unitPrice||0).toFixed(2),category:x.category||"Water Products",reference_id:x.referenceId||`${input.orderId}-${i+1}`,description:x.title||"SUBIL product",discount_amount:"0.00",image_url:x.imageUrl||"https://subil.store/",product_url:x.productUrl||"https://subil.store/",is_refundable:true}));
 const payload={payment:{amount:input.amount.toFixed(2),currency:input.currency,description:`SUBIL ${input.orderId}`,buyer:{name:input.customer?.name||"عميل سبيل",email:input.customer?.email||"customer@subil.store",phone:saPhone(input.customer?.phone||"")},shipping_address:{city:input.shipping?.city||"Riyadh",address:input.shipping?.address||"Riyadh",zip:input.shipping?.zip||"00000"},order:{reference_id:input.orderId,items:rows,tax_amount:"0.00",shipping_amount:"0.00",discount_amount:"0.00"},meta:{order_id:input.orderId}},lang:"ar",merchant_code:merchantCode,merchant_urls:{success:`${input.origin}/payment-return?provider=tabby&status=success&order=${encodeURIComponent(input.orderId)}`,cancel:`${input.origin}/payment-return?provider=tabby&status=cancel&order=${encodeURIComponent(input.orderId)}`,failure:`${input.origin}/payment-return?provider=tabby&status=failure&order=${encodeURIComponent(input.orderId)}`}};
 const response=await fetch("https://api.tabby.sa/api/v2/checkout",{method:"POST",headers:jsonHeaders({authorization:`Bearer ${secret}`}),body:JSON.stringify(payload),cache:"no-store"});
 const data=await parse(response);const url=String(data?.configuration?.available_products?.installments?.[0]?.web_url||data?.web_url||data?.checkout_url||"");return {provider:"tabby",providerReference:String(data?.payment?.id||data?.id||""),checkoutUrl:url,status:String(data?.status||data?.payment?.status||"created").toLowerCase(),raw:{id:data?.id,payment_id:data?.payment?.id,status:data?.status}};
}

async function createTamaraSession(input:ProviderSessionInput){
 const token=String(process.env.TAMARA_API_TOKEN||"").trim();if(!token)throw new Error("payment_provider_not_configured");
 const rows=itemRows(input.items,input.amount).map((x,i)=>({reference_id:x.referenceId||`${input.orderId}-${i+1}`,type:"Physical",name:x.title||`منتج ${i+1}`,sku:x.referenceId||`${input.orderId}-${i+1}`,quantity:Number(x.quantity||1),unit_price:{amount:Number(x.unitPrice||0),currency:input.currency},total_amount:{amount:Number(x.unitPrice||0)*Number(x.quantity||1),currency:input.currency}}));
 const payload:any={total_amount:{amount:input.amount,currency:input.currency},shipping_amount:{amount:0,currency:input.currency},tax_amount:{amount:0,currency:input.currency},order_reference_id:input.orderId,order_number:input.orderId,discount:{name:"",amount:{amount:0,currency:input.currency}},items:rows,consumer:{first_name:input.customer?.name||"عميل",last_name:"سبيل",phone_number:saPhone(input.customer?.phone||""),email:input.customer?.email||"customer@subil.store"},country_code:"SA",description:`SUBIL ${input.orderId}`,merchant_url:{success:`${input.origin}/payment-return?provider=tamara&status=success&order=${encodeURIComponent(input.orderId)}`,failure:`${input.origin}/payment-return?provider=tamara&status=failure&order=${encodeURIComponent(input.orderId)}`,cancel:`${input.origin}/payment-return?provider=tamara&status=cancel&order=${encodeURIComponent(input.orderId)}`,notification:`${input.origin}/api/payments/webhooks/tamara`},shipping_address:{first_name:input.customer?.name||"عميل",last_name:"سبيل",line1:input.shipping?.address||"Riyadh",city:input.shipping?.city||"Riyadh",country_code:"SA"},platform:"SUBIL",is_mobile:true,locale:"ar_SA"};
 const base=String(process.env.TAMARA_API_BASE||"https://api.tamara.co").replace(/\/$/,"");
 const response=await fetch(`${base}/checkout`,{method:"POST",headers:jsonHeaders({authorization:`Bearer ${token}`}),body:JSON.stringify(payload),cache:"no-store"});
 const data=await parse(response);return {provider:"tamara",providerReference:String(data?.order_id||data?.checkout_id||""),checkoutUrl:String(data?.checkout_url||""),status:String(data?.status||"created").toLowerCase(),raw:{order_id:data?.order_id,checkout_id:data?.checkout_id,status:data?.status}};
}

export async function createProviderSession(input:ProviderSessionInput){
 if(["tap","mada","cards","stc_pay","apple_pay"].includes(input.provider))return createTapSession(input);
 if(input.provider==="amwal")return createAmwalSession(input);
 if(input.provider==="tabby")return createTabbySession(input);
 if(input.provider==="tamara")return createTamaraSession(input);
 throw new Error("payment_provider_not_found");
}

type CartLine={id:number;quantity:number;variation?:Array<{attribute:string;value:string}>;item_data?:Array<{key:string;value:string}>};
type WooAddress={first_name?:string;last_name?:string;address_1?:string;address_2?:string;city?:string;state?:string;postcode?:string;country?:string;email?:string;phone?:string};

function config(){
 const base=String(process.env.SUBIL_WOO_REST_API_BASE||process.env.WOOCOMMERCE_BASE_URL||"https://subil.store/wp-json/wc/v3").replace(/\/$/,"");
 const key=String(process.env.WOO_CONSUMER_KEY||process.env.WOOCOMMERCE_CONSUMER_KEY||"").trim();
 const secret=String(process.env.WOO_CONSUMER_SECRET||process.env.WOOCOMMERCE_CONSUMER_SECRET||"").trim();
 if(!key||!secret)throw new Error("woocommerce_runtime_not_configured");
 return {base,authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`};
}

async function request(path:string,init:RequestInit={}){
 const {base,authorization}=config();
 const response=await fetch(`${base}${path}`,{...init,headers:{accept:"application/json","content-type":"application/json",authorization,...(init.headers||{})},cache:"no-store"});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(String(data?.message||data?.code||`woocommerce_http_${response.status}`));
 return data;
}

export async function createPendingWooOrder(input:{provider:string;cartLines:CartLine[];billing:WooAddress;shipping:WooAddress;customerNote?:string}){
 const line_items=(input.cartLines||[]).filter(x=>Number(x.id)>0&&Number(x.quantity)>0).map(x=>({product_id:Number(x.id),quantity:Number(x.quantity)}));
 if(!line_items.length)throw new Error("empty_cart");
 const data=await request("/orders",{method:"POST",body:JSON.stringify({status:"pending",set_paid:false,payment_method:`subil_${input.provider}`,payment_method_title:`SUBIL ${input.provider}`,billing:input.billing,shipping:input.shipping,customer_note:input.customerNote||"طلب من تطبيق سبيل",line_items,meta_data:[{key:"_subil_payment_provider",value:input.provider},{key:"_subil_channel",value:"native-app"}]})});
 return {id:String(data?.id||""),number:String(data?.number||data?.id||""),status:String(data?.status||"pending"),total:String(data?.total||"")};
}

export async function syncWooOrderPayment(event:{orderId:string;status:"paid"|"pending"|"failed"|"cancelled";provider:string;providerReference?:string;rawStatus?:string}){
 const id=String(event.orderId||"").trim();
 if(!/^\d+$/.test(id))return {skipped:true,reason:"non_woo_order_id"};
 const status=event.status==="paid"?"processing":event.status==="failed"?"failed":event.status==="cancelled"?"cancelled":"pending";
 const body:any={status,payment_method:`subil_${event.provider}`,payment_method_title:`SUBIL ${event.provider}`};
 if(event.providerReference)body.transaction_id=event.providerReference;
 const order=await request(`/orders/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify(body)});
 const note=`SUBIL Payment: ${event.provider} | ${event.status}${event.rawStatus?` (${event.rawStatus})`:""}${event.providerReference?` | Ref: ${event.providerReference}`:""}`;
 await request(`/orders/${encodeURIComponent(id)}/notes`,{method:"POST",body:JSON.stringify({note,customer_note:false})}).catch(()=>null);
 return {id:String(order?.id||id),status:String(order?.status||status)};
}

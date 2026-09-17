import {NextRequest,NextResponse} from "next/server";

const upstream=(process.env.SUBIL_WOO_STORE_API_BASE||"https://subil.store/wp-json/wc/store/v1").replace(/\/$/,"");

function labelFor(id:string){
 const x=id.toLowerCase();
 if(x.includes("amwal"))return x.includes("install")?"أموال - تقسيط":"أموال";
 if(x.includes("tabby"))return"تابي";
 if(x.includes("tamara"))return"تمارا";
 if(x.includes("apple"))return"Apple Pay";
 if(x.includes("mada"))return"مدى";
 if(x.includes("stc"))return"STC Pay";
 if(x.includes("tap"))return"Tap";
 if(x.includes("cod"))return"الدفع عند الاستلام";
 return id.replace(/[_-]+/g," ");
}

export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
 try{
  const headers=new Headers({accept:"application/json"});
  const cartToken=request.cookies.get("subil_woo_cart_token")?.value;
  const nonce=request.cookies.get("subil_woo_nonce")?.value;
  if(cartToken)headers.set("Cart-Token",cartToken);
  if(!cartToken&&nonce)headers.set("Nonce",nonce);
  const response=await fetch(`${upstream}/cart`,{headers,cache:"no-store"});
  const cart=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("store_unavailable");
  const ids=Array.isArray(cart?.payment_methods)?cart.payment_methods.map((x:any)=>String(x)):[];
  const methods=ids.map((id:string)=>({id,label:labelFor(id),enabled:true,status:"ready",missing:[],mode:"woocommerce_hosted_native_webview" as const}));
  return NextResponse.json({
    status:"ready",
    ready_count:methods.length,
    total_count:methods.length,
    source:"woocommerce_store_api",
    architecture:"woocommerce_hosted_native_webview",
    methods
  },{headers:{"cache-control":"no-store"}});
 }catch{
  return NextResponse.json({status:"partial",ready_count:0,total_count:0,source:"woocommerce_store_api",architecture:"woocommerce_hosted_native_webview",methods:[],error:"store_unavailable"},{status:503,headers:{"cache-control":"no-store"}});
 }
}

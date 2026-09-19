import {NextRequest,NextResponse} from "next/server";

const upstream=(process.env.SUBIL_WOO_STORE_API_BASE||"https://subil.store/wp-json/wc/store/v1").replace(/\/$/,"");
const allowed=[
  /^products(?:\/\d+)?$/,
  /^products\/categories$/,
  /^cart$/,
  /^cart\/(?:add-item|update-item|remove-item|update-customer|select-shipping-rate|apply-coupon|remove-coupon)$/,
  /^checkout$/,
  /^order\/\d+$/
];

function safePath(parts:string[]){const path=parts.join("/");return allowed.some(rule=>rule.test(path))?path:null}
function paymentMode(method:string){const value=(method||"").toLowerCase();return value.includes("tabby")||value.includes("tamara")||value.includes("amwal")||value.includes("tap")?"direct":"embedded"}

async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
  const {path:parts}=await context.params;
  const path=safePath(parts||[]);
  if(!path)return NextResponse.json({error:"store_path_not_allowed"},{status:404});

  const target=new URL(`${upstream}/${path}`);
  request.nextUrl.searchParams.forEach((value,key)=>target.searchParams.append(key,value));
  const headers=new Headers({accept:"application/json"});
  const cartToken=request.cookies.get("subil_woo_cart_token")?.value;
  const nonce=request.cookies.get("subil_woo_nonce")?.value;
  if(cartToken)headers.set("Cart-Token",cartToken);
  if(nonce)headers.set("Nonce",nonce);
  if(request.method!=="GET"&&request.method!=="HEAD")headers.set("content-type","application/json");

  const body=request.method==="GET"||request.method==="HEAD"?undefined:await request.text();
  let selectedPaymentMethod="";
  if(path==="checkout"&&body){
    try{selectedPaymentMethod=String(JSON.parse(body)?.payment_method||"")}catch{}
  }

  let upstreamResponse:Response;
  try{
    upstreamResponse=await fetch(target,{method:request.method,headers,body:body||undefined,cache:"no-store",redirect:"manual"});
  }catch{
    return NextResponse.json({error:"store_unavailable"},{status:503});
  }

  const contentType=upstreamResponse.headers.get("content-type")||"application/json";
  const raw=await upstreamResponse.text();
  if(path==="checkout"&&!upstreamResponse.ok){console.error(JSON.stringify({event:"subil.checkout_error",status:upstreamResponse.status,method:selectedPaymentMethod,hasCartToken:Boolean(cartToken),hasNonce:Boolean(nonce),body:raw.slice(0,2000)}));}
  let output=raw;
  let paymentTarget="";
  let mode="embedded";

  if(path==="checkout"&&contentType.includes("application/json")&&raw){
    try{
      const payload=JSON.parse(raw);
      const redirect=String(payload?.payment_result?.redirect_url||"");
      if(redirect){
        const parsed=new URL(redirect);
        if(parsed.protocol==="https:"){
          paymentTarget=parsed.toString();
          mode=paymentMode(selectedPaymentMethod);
          payload.payment_result.redirect_url="/payment";
          output=JSON.stringify(payload);
        }
      }
    }catch{}
  }

  const response=new NextResponse(output,{status:upstreamResponse.status,headers:{"content-type":contentType,"cache-control":"no-store"}});
  if(path==="checkout"&&upstreamResponse.status===409){
    response.cookies.set("subil_woo_cart_token","",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});
    response.cookies.set("subil_woo_nonce","",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});
  }
  const nextToken=upstreamResponse.headers.get("Cart-Token");
  const nextNonce=upstreamResponse.headers.get("Nonce");
  const cookieOptions={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:60*60*24*7};
  if(nextToken)response.cookies.set("subil_woo_cart_token",nextToken,cookieOptions);
  if(path==="cart"&&request.method==="GET"&&!cartToken&&nextToken){console.info(JSON.stringify({event:"subil.cart_session_created"}));}
  if(path==="cart/add-item"){console.info(JSON.stringify({event:"subil.cart_item_added",status:upstreamResponse.status,hadCartToken:Boolean(cartToken),receivedCartToken:Boolean(nextToken)}));}
  if(nextNonce)response.cookies.set("subil_woo_nonce",nextNonce,cookieOptions);
  if(paymentTarget){
    response.cookies.set("subil_payment_target",paymentTarget,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:60*20});
    response.cookies.set("subil_payment_mode",mode,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:60*20});
  }
  return response;
}

export const dynamic="force-dynamic";
export const GET=proxy;
export const POST=proxy;
export const PUT=proxy;
export const DELETE=proxy;

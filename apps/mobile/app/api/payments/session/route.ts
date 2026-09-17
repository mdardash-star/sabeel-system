import {NextRequest,NextResponse} from "next/server";
import {createProviderSession} from "./provider-sessions";

const providerEnv:Record<string,string[]>={
 tap:["TAP_SECRET_KEY"],
 amwal:["AMWAL_API_KEY","AMWAL_SECRET_KEY","AMWAL_STORE_ID"],
 tabby:["TABBY_SECRET_KEY","TABBY_MERCHANT_CODE"],
 tamara:["TAMARA_API_TOKEN"],
 apple_pay:["TAP_SECRET_KEY"],
 mada:["TAP_SECRET_KEY"],
 cards:["TAP_SECRET_KEY"],
 stc_pay:["TAP_SECRET_KEY"]
};

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);
 const provider=String(body?.provider||"").trim();
 const orderId=String(body?.orderId||"").trim();
 const amount=Number(body?.amount);
 const currency=String(body?.currency||"SAR").toUpperCase();
 if(!providerEnv[provider])return NextResponse.json({error:"payment_provider_not_found"},{status:404});
 if(!orderId||!Number.isFinite(amount)||amount<=0||currency!=="SAR")return NextResponse.json({error:"invalid_payment_request"},{status:400});
 const missing=providerEnv[provider].filter(key=>!String(process.env[key]||"").trim());
 if(missing.length)return NextResponse.json({error:"payment_provider_not_configured",provider},{status:503});
 try{
   const session=await createProviderSession({provider,orderId,amount,currency:"SAR",customer:body?.customer,shipping:body?.shipping,items:Array.isArray(body?.items)?body.items:[],origin:request.nextUrl.origin});
   return NextResponse.json({...session,mode:"native_sdk"},{headers:{"cache-control":"no-store"}});
 }catch(error){
   const message=error instanceof Error?error.message:"payment_session_failed";
   return NextResponse.json({error:message,provider},{status:message==="payment_provider_not_configured"?503:502,headers:{"cache-control":"no-store"}});
 }
}

import {NextRequest,NextResponse} from "next/server";

const providerEnv:Record<string,string[]>={
 tap:["TAP_SECRET_KEY"],
 amwal:["AMWAL_API_KEY"],
 tabby:["TABBY_SECRET_KEY"],
 tamara:["TAMARA_API_TOKEN"],
 apple_pay:["APPLE_PAY_MERCHANT_ID"],
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
 return NextResponse.json({provider,orderId,amount,currency,mode:"native_sdk",status:"ready_for_native_initialization"},{headers:{"cache-control":"no-store"}});
}

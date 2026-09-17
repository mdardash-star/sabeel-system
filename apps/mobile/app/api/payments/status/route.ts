import {NextRequest,NextResponse} from "next/server";

function normalized(provider:string,raw:string){
 const s=raw.toLowerCase().replace(/\s+/g,"_");
 if(provider==="tap")return ["captured","authorized"].includes(s)?"paid":["failed","declined","restricted","timedout"].includes(s)?"failed":["cancelled","abandoned","void"].includes(s)?"cancelled":"pending";
 if(provider==="tabby")return ["authorized","closed"].includes(s)?"paid":s==="rejected"?"failed":s==="expired"?"cancelled":"pending";
 if(provider==="tamara")return ["approved","authorised","authorized","captured","fully_captured","paid","success"].includes(s)?"paid":["declined","failed","rejected"].includes(s)?"failed":["canceled","cancelled","expired"].includes(s)?"cancelled":"pending";
 if(provider==="amwal")return ["paid","success"].includes(s)?"paid":["failed","rejected"].includes(s)?"failed":["expired","cancelled","canceled"].includes(s)?"cancelled":"pending";
 return "pending";
}

async function json(response:Response){const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`provider_http_${response.status}`);return data}

export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const provider=String(request.nextUrl.searchParams.get("provider")||"").toLowerCase();
 const reference=String(request.nextUrl.searchParams.get("reference")||"").trim();
 if(!reference||!["tap","tabby","tamara","amwal"].includes(provider))return NextResponse.json({error:"invalid_payment_status_request"},{status:400});
 try{
   let data:any={};let rawStatus="";let orderId="";
   if(provider==="tap"){
     const secret=String(process.env.TAP_SECRET_KEY||"").trim();if(!secret)throw new Error("payment_provider_not_configured");
     data=await json(await fetch(`https://api.tap.company/v2/charges/${encodeURIComponent(reference)}`,{headers:{authorization:`Bearer ${secret}`,accept:"application/json"},cache:"no-store"}));
     rawStatus=String(data?.status||"");orderId=String(data?.reference?.order||"");
   }else if(provider==="tabby"){
     const secret=String(process.env.TABBY_SECRET_KEY||"").trim();if(!secret)throw new Error("payment_provider_not_configured");
     const headers:Record<string,string>={authorization:`Bearer ${secret}`,accept:"application/json"};const merchant=String(process.env.TABBY_MERCHANT_CODE||"").trim();if(merchant)headers["x-merchant-code"]=merchant;
     data=await json(await fetch(`https://api.tabby.sa/api/v2/payments/${encodeURIComponent(reference)}`,{headers,cache:"no-store"}));
     rawStatus=String(data?.status||"");orderId=String(data?.order?.reference_id||data?.meta?.order_id||"");
   }else if(provider==="tamara"){
     const token=String(process.env.TAMARA_API_TOKEN||"").trim();if(!token)throw new Error("payment_provider_not_configured");
     const base=String(process.env.TAMARA_API_BASE||"https://api.tamara.co").replace(/\/$/,"");
     data=await json(await fetch(`${base}/orders/${encodeURIComponent(reference)}`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},cache:"no-store"}));
     rawStatus=String(data?.status||"");orderId=String(data?.order_reference_id||data?.order_number||"");
   }else{
     const apiKey=String(process.env.AMWAL_API_KEY||"").trim();const secret=String(process.env.AMWAL_SECRET_KEY||"").trim();if(!apiKey||!secret)throw new Error("payment_provider_not_configured");
     data=await json(await fetch(`https://backend.sa.amwal.tech/payment_links/${encodeURIComponent(reference)}/details`,{headers:{authorization:secret,"x-amwal-key":apiKey,accept:"application/json"},cache:"no-store"}));
     rawStatus=String(data?.status||data?.payment_status||"");orderId=String(data?.order_details?.order_id||data?.metadata?.order_id||"");
   }
   return NextResponse.json({provider,reference,orderId,status:normalized(provider,rawStatus),rawStatus},{headers:{"cache-control":"no-store"}});
 }catch(error){
   const message=error instanceof Error?error.message:"payment_status_failed";
   return NextResponse.json({error:message,provider},{status:message==="payment_provider_not_configured"?503:502,headers:{"cache-control":"no-store"}});
 }
}

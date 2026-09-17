import {NextRequest,NextResponse} from "next/server";
import {normalizePaymentEvent,verifyTabby} from "../payment-verification";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 if(!verifyTabby(request.headers))return NextResponse.json({error:"invalid_signature"},{status:401});
 const raw=await request.text();let payload:any={};try{payload=JSON.parse(raw)}catch{return NextResponse.json({error:"invalid_json"},{status:400})}
 return NextResponse.json({ok:true,event:normalizePaymentEvent("tabby",payload)},{headers:{"cache-control":"no-store"}});
}

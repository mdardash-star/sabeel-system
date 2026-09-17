import {NextRequest,NextResponse} from "next/server";
import {normalizePaymentEvent,verifyAmwal} from "../payment-verification";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const raw=await request.text();
 if(!verifyAmwal(raw,request.headers))return NextResponse.json({error:"invalid_signature"},{status:401});
 let payload:any={};try{payload=JSON.parse(raw)}catch{return NextResponse.json({error:"invalid_json"},{status:400})}
 return NextResponse.json({ok:true,event:normalizePaymentEvent("amwal",payload)},{headers:{"cache-control":"no-store"}});
}

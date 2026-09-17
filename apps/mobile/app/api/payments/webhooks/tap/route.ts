import {NextRequest,NextResponse} from "next/server";
import {normalizePaymentEvent,verifyTap} from "../payment-verification";
import {syncVerifiedPaymentEvent} from "../payment-event-sync";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const raw=await request.text();let payload:any={};try{payload=JSON.parse(raw)}catch{return NextResponse.json({error:"invalid_json"},{status:400})}
 if(!verifyTap(payload,request.headers))return NextResponse.json({error:"invalid_signature"},{status:401});
 const event=normalizePaymentEvent("tap",payload);
 try{const sync=await syncVerifiedPaymentEvent(event);return NextResponse.json({ok:true,event,sync},{headers:{"cache-control":"no-store"}})}catch(error){return NextResponse.json({error:"payment_sync_failed",event},{status:503,headers:{"cache-control":"no-store"}})}
}

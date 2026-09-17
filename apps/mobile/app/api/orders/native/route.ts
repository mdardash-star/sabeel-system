import {NextRequest,NextResponse} from "next/server";
import {createPendingWooOrder} from "../../payments/woo-runtime";

export const dynamic="force-dynamic";

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);
 const provider=String(body?.provider||"").trim();
 const lines=Array.isArray(body?.line_items)?body.line_items:[];
 if(!provider||!lines.length)return NextResponse.json({error:"invalid_native_order"},{status:400});
 try{
   const order=await createPendingWooOrder({provider,cartLines:lines,billing:body?.billing||{},shipping:body?.shipping||{},customerNote:"طلب شراء من تطبيق سبيل"});
   if(!order.id)return NextResponse.json({error:"woocommerce_order_creation_failed"},{status:502});
   return NextResponse.json(order,{headers:{"cache-control":"no-store"}});
 }catch(error){
   const message=error instanceof Error?error.message:"woocommerce_order_creation_failed";
   return NextResponse.json({error:message},{status:message==="woocommerce_runtime_not_configured"?503:502,headers:{"cache-control":"no-store"}});
 }
}

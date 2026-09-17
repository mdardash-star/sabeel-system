import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  const target=request.cookies.get("subil_payment_target")?.value||"";
  if(!target)return NextResponse.json({error:"payment_target_missing"},{status:404});
  try{
    const url=new URL(target);
    if(url.protocol!=="https:")throw new Error("invalid");
    return NextResponse.json({url:url.toString()},{headers:{"cache-control":"no-store"}});
  }catch{
    return NextResponse.json({error:"payment_target_invalid"},{status:400});
  }
}

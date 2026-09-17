import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  const target=request.cookies.get("subil_payment_target")?.value||"";
  if(!target)return NextResponse.json({error:"payment_target_missing"},{status:404,headers:{"cache-control":"no-store"}});
  try{
    const url=new URL(target);
    if(url.protocol!=="https:")throw new Error("invalid");
    return NextResponse.json({url:url.toString()},{headers:{"cache-control":"no-store"}});
  }catch{
    return NextResponse.json({error:"payment_target_invalid"},{status:400,headers:{"cache-control":"no-store"}});
  }
}

export async function DELETE(){
  const response=NextResponse.json({ok:true},{headers:{"cache-control":"no-store"}});
  response.cookies.set("subil_payment_target","",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});
  return response;
}

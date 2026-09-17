import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  const lat=request.nextUrl.searchParams.get("lat")||"";
  const lon=request.nextUrl.searchParams.get("lon")||"";
  if(!/^[-+]?\d+(\.\d+)?$/.test(lat)||!/^[-+]?\d+(\.\d+)?$/.test(lon))return NextResponse.json({error:"invalid_coordinates"},{status:400});
  const url=new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format","jsonv2");
  url.searchParams.set("lat",lat);
  url.searchParams.set("lon",lon);
  url.searchParams.set("addressdetails","1");
  url.searchParams.set("accept-language","ar,en");
  try{
    const r=await fetch(url,{headers:{accept:"application/json","user-agent":"SUBIL-OS/1.0 (subil.store)"},cache:"no-store"});
    if(!r.ok)return NextResponse.json({error:"geocode_unavailable"},{status:502});
    const data=await r.json();
    const a=data?.address||{};
    return NextResponse.json({postcode:String(a.postcode||""),city:String(a.city||a.town||a.village||a.municipality||"الرياض"),state:String(a.state||""),displayName:String(data?.display_name||"")});
  }catch{return NextResponse.json({error:"geocode_unavailable"},{status:503})}
}

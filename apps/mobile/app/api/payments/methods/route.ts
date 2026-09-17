import {NextResponse} from "next/server";

const providers=[
 {id:"tap",label:"تاب",required:["TAP_SECRET_KEY"]},
 {id:"amwal",label:"أموال",required:["AMWAL_API_KEY"]},
 {id:"tabby",label:"تابي",required:["TABBY_SECRET_KEY"]},
 {id:"tamara",label:"تمارا",required:["TAMARA_API_TOKEN"]},
 {id:"apple_pay",label:"Apple Pay",required:["APPLE_PAY_MERCHANT_ID"]},
 {id:"mada",label:"مدى",required:["TAP_SECRET_KEY"]},
 {id:"cards",label:"البطاقات",required:["TAP_SECRET_KEY"]},
 {id:"stc_pay",label:"إس تي سي باي",required:["TAP_SECRET_KEY"]}
];

export const dynamic="force-dynamic";

export async function GET(){
 const methods=providers.map(p=>({
   id:p.id,
   label:p.label,
   enabled:p.required.every(key=>Boolean(String(process.env[key]||"").trim())),
   mode:"native_sdk" as const
 }));
 return NextResponse.json({methods},{headers:{"cache-control":"no-store"}});
}

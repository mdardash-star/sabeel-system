"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {nativePaymentsAvailable,startNativePayment,NativePaymentProvider} from "../payments/native-payment-bridge";

type Method={id:NativePaymentProvider;label:string;enabled:boolean;mode:string};
type CartItem={id:number;name:string;quantity:number;permalink?:string;images?:Array<{src?:string}>;prices?:{price?:string;currency_minor_unit?:number};totals?:{line_total?:string;currency_minor_unit?:number}};
type Cart={items_count:number;items?:CartItem[];billing_address?:{first_name?:string;last_name?:string;email?:string;phone?:string};shipping_address?:{city?:string;address_1?:string;postcode?:string};totals:{total_price:string;currency_code:string;currency_minor_unit:number;currency_symbol:string}};

function amount(value:string|undefined,minor=2){return Number(value||0)/10**minor}

export default function NativeCheckout(){
 const router=useRouter();
 const [methods,setMethods]=useState<Method[]>([]),[cart,setCart]=useState<Cart|null>(null),[selected,setSelected]=useState<NativePaymentProvider|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState("");
 useEffect(()=>{(async()=>{try{const [m,c]=await Promise.all([fetch("/api/payments/methods",{cache:"no-store"}),fetch("/api/store/cart",{cache:"no-store"})]);const mp=await m.json();const cp=await c.json();const enabled=(mp.methods||[]).filter((x:Method)=>x.enabled);setMethods(enabled);setSelected(enabled[0]?.id||null);setCart(cp)}catch{setError("تعذر تجهيز وسائل الدفع")}})()},[]);
 const total=useMemo(()=>cart?amount(cart.totals.total_price,cart.totals.currency_minor_unit):0,[cart]);
 async function pay(){
   if(!selected||!cart)return;
   if(!nativePaymentsAvailable()){setError("الدفع الداخلي متاح من تطبيق سبيل المثبت فقط");return}
   setBusy(true);setError("");setResult("");
   try{
     const orderId=`subil-${Date.now()}`;
     const customer={
       name:[cart.billing_address?.first_name,cart.billing_address?.last_name].filter(Boolean).join(" ")||"عميل سبيل",
       email:cart.billing_address?.email||"",
       phone:cart.billing_address?.phone||""
     };
     const shipping={
       city:cart.shipping_address?.city||"الرياض",
       address:cart.shipping_address?.address_1||"الرياض",
       zip:cart.shipping_address?.postcode||"00000"
     };
     const items=(cart.items||[]).map((item,index)=>{
       const minor=item.prices?.currency_minor_unit??item.totals?.currency_minor_unit??2;
       const unit=item.prices?.price?amount(item.prices.price,minor):(item.quantity>0?amount(item.totals?.line_total,minor)/item.quantity:0);
       return {title:item.name,quantity:item.quantity,unitPrice:unit,referenceId:String(item.id||`${orderId}-${index+1}`),category:"Water Products",imageUrl:item.images?.[0]?.src||"",productUrl:item.permalink||"https://subil.store/"};
     });
     const sessionResponse=await fetch("/api/payments/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:selected,orderId,amount:total,currency:"SAR",customer,shipping,items})});
     const session=await sessionResponse.json().catch(()=>({}));
     if(!sessionResponse.ok)throw new Error(session.error||"payment_session_failed");
     const paymentResult=await startNativePayment({provider:selected,orderId,amount:total,currency:"SAR",customer,session:{providerReference:session.providerReference,checkoutUrl:session.checkoutUrl,status:session.status,mode:session.mode}});
     if(paymentResult.status==="paid")setResult("تم الدفع بنجاح");
     else if(paymentResult.status==="cancelled")setResult("تم إلغاء عملية الدفع");
     else if(paymentResult.status==="pending")setResult("عملية الدفع قيد المعالجة");
     else setError(paymentResult.message||"تعذر إتمام الدفع");
   }catch(e){setError(e instanceof Error?e.message:"تعذر إتمام الدفع")}finally{setBusy(false)}
 }
 return <main style={s.page} dir="rtl"><section style={s.card}><button style={s.back} onClick={()=>router.replace("/store")}>رجوع</button><small style={s.kicker}>سبيل</small><h1 style={s.title}>الدفع داخل التطبيق</h1><p style={s.note}>اختر وسيلة الدفع. لا يتم فتح صفحة المتجر أثناء عملية الدفع.</p>{cart&&<div style={s.summary}><span>عدد القطع</span><b>{cart.items_count}</b><span>الإجمالي</span><b>{total.toLocaleString("ar-SA",{maximumFractionDigits:2})} {cart.totals.currency_symbol||"ر.س"}</b></div>}{error&&<div style={s.error}>{error}</div>}{result&&<div style={s.ok}>{result}</div>}<section style={s.methods}><b>وسيلة الدفع</b>{methods.length?methods.map(m=><label key={m.id} style={s.method}><input type="radio" name="native-payment" checked={selected===m.id} onChange={()=>setSelected(m.id)}/><span>{m.label}</span></label>):<p style={s.note}>لا توجد بوابات مهيأة للدفع الداخلي حتى الآن.</p>}</section><button style={s.primary} disabled={busy||!selected||!cart?.items_count} onClick={pay}>{busy?"جاري بدء الدفع":"الدفع الآن"}</button></section></main>
}

const s:Record<string,React.CSSProperties>={page:{minHeight:"100vh",background:"#f4f7f6",padding:16,fontFamily:"inherit"},card:{maxWidth:680,margin:"0 auto",background:"#fff",borderRadius:22,padding:18,boxShadow:"0 12px 36px rgba(0,0,0,.06)"},back:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:10,padding:"9px 12px",fontWeight:800,marginBottom:14},kicker:{color:"#20a957",fontWeight:800},title:{margin:"4px 0 6px",fontSize:26},note:{color:"#6b7280",lineHeight:1.7},summary:{display:"grid",gridTemplateColumns:"1fr auto",gap:"10px 16px",background:"#f7faf8",borderRadius:16,padding:16,margin:"16px 0"},methods:{display:"grid",gap:10,background:"#f7faf8",borderRadius:16,padding:15},method:{display:"flex",alignItems:"center",gap:10,fontWeight:800,padding:"8px 0"},primary:{width:"100%",border:0,borderRadius:15,padding:"15px 18px",background:"#20a957",color:"#fff",fontWeight:900,fontSize:17,marginTop:16},error:{padding:12,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700,margin:"12px 0"},ok:{padding:12,borderRadius:12,background:"#eaf8f0",color:"#168744",fontWeight:800,margin:"12px 0"}};

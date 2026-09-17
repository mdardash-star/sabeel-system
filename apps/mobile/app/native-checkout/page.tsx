"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {nativePaymentsAvailable,startNativePayment,NativePaymentProvider} from "../payments/native-payment-bridge";

type Method={id:NativePaymentProvider;label:string;enabled:boolean;mode:string};
type Address={first_name?:string;last_name?:string;address_1?:string;address_2?:string;city?:string;state?:string;postcode?:string;country?:string;email?:string;phone?:string};
type CartItem={id:number;name:string;quantity:number;permalink?:string;images?:Array<{src?:string}>;prices?:{price?:string;currency_minor_unit?:number};totals?:{line_total?:string;currency_minor_unit?:number}};
type Cart={items_count:number;items?:CartItem[];billing_address?:Address;shipping_address?:Address;totals:{total_price:string;currency_code:string;currency_minor_unit:number;currency_symbol:string}};

function amount(value:string|undefined,minor=2){return Number(value||0)/10**minor}
async function readJson(response:Response){const p=await response.json().catch(()=>({}));if(!response.ok)throw new Error(p?.error||p?.message||"تعذر إكمال العملية");return p}

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
     const billing=cart.billing_address||{};
     const shippingAddress=cart.shipping_address||{};
     const wooOrder=await readJson(await fetch("/api/orders/native",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:selected,line_items:(cart.items||[]).map(i=>({id:i.id,quantity:i.quantity})),billing,shipping:shippingAddress})}));
     const orderId=String(wooOrder.id||"");
     const orderTotal=Number(wooOrder.total||total);
     if(!orderId||!Number.isFinite(orderTotal)||orderTotal<=0)throw new Error("تعذر إنشاء طلب المتجر قبل الدفع");
     const customer={name:[billing.first_name,billing.last_name].filter(Boolean).join(" ")||"عميل سبيل",email:billing.email||"",phone:billing.phone||""};
     const shipping={city:shippingAddress.city||"الرياض",address:shippingAddress.address_1||"الرياض",zip:shippingAddress.postcode||"00000"};
     const items=(cart.items||[]).map((item,index)=>{const minor=item.prices?.currency_minor_unit??item.totals?.currency_minor_unit??2;const unit=item.prices?.price?amount(item.prices.price,minor):(item.quantity>0?amount(item.totals?.line_total,minor)/item.quantity:0);return {title:item.name,quantity:item.quantity,unitPrice:unit,referenceId:String(item.id||`${orderId}-${index+1}`),category:"Water Products",imageUrl:item.images?.[0]?.src||"",productUrl:item.permalink||"https://subil.store/"}});
     const session=await readJson(await fetch("/api/payments/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:selected,orderId,amount:orderTotal,currency:"SAR",customer,shipping,items})}));
     const paymentResult=await startNativePayment({provider:selected,orderId,amount:orderTotal,currency:"SAR",customer,session:{providerReference:session.providerReference,checkoutUrl:session.checkoutUrl,status:session.status,mode:session.mode}});
     const reference=String(paymentResult.providerReference||paymentResult.transactionId||session.providerReference||"");
     let verifiedStatus=paymentResult.status;
     if(reference){
       const verify=await fetch(`/api/payments/status?provider=${encodeURIComponent(selected)}&reference=${encodeURIComponent(reference)}`,{cache:"no-store"});
       if(verify.ok){const v=await verify.json();verifiedStatus=v.status||verifiedStatus}
     }
     if(verifiedStatus==="paid")setResult(`تم الدفع بنجاح للطلب رقم ${orderId}`);
     else if(verifiedStatus==="cancelled")setResult(`تم إلغاء عملية الدفع للطلب رقم ${orderId}`);
     else if(verifiedStatus==="pending")setResult(`الطلب رقم ${orderId} قيد التحقق من الدفع`);
     else setError(paymentResult.message||`تعذر إتمام الدفع للطلب رقم ${orderId}`);
   }catch(e){setError(e instanceof Error?e.message:"تعذر إتمام الدفع")}finally{setBusy(false)}
 }
 return <main style={s.page} dir="rtl"><section style={s.card}><button style={s.back} onClick={()=>router.replace("/store")}>رجوع</button><small style={s.kicker}>سبيل</small><h1 style={s.title}>الدفع داخل التطبيق</h1><p style={s.note}>اختر وسيلة الدفع. يتم إنشاء الطلب والتحقق من الدفع من الخادم بدون فتح صفحة المتجر.</p>{cart&&<div style={s.summary}><span>عدد القطع</span><b>{cart.items_count}</b><span>الإجمالي</span><b>{total.toLocaleString("ar-SA",{maximumFractionDigits:2})} {cart.totals.currency_symbol||"ر.س"}</b></div>}{error&&<div style={s.error}>{error}</div>}{result&&<div style={s.ok}>{result}</div>}<section style={s.methods}><b>وسيلة الدفع</b>{methods.length?methods.map(m=><label key={m.id} style={s.method}><input type="radio" name="native-payment" checked={selected===m.id} onChange={()=>setSelected(m.id)}/><span>{m.label}</span></label>):<p style={s.note}>لا توجد بوابات مهيأة للدفع الداخلي حتى الآن.</p>}</section><button style={s.primary} disabled={busy||!selected||!cart?.items_count} onClick={pay}>{busy?"جاري بدء الدفع":"الدفع الآن"}</button></section></main>
}

const s:Record<string,React.CSSProperties>={page:{minHeight:"100vh",background:"#f4f7f6",padding:16,fontFamily:"inherit"},card:{maxWidth:680,margin:"0 auto",background:"#fff",borderRadius:22,padding:18,boxShadow:"0 12px 36px rgba(0,0,0,.06)"},back:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:10,padding:"9px 12px",fontWeight:800,marginBottom:14},kicker:{color:"#20a957",fontWeight:800},title:{margin:"4px 0 6px",fontSize:26},note:{color:"#6b7280",lineHeight:1.7},summary:{display:"grid",gridTemplateColumns:"1fr auto",gap:"10px 16px",background:"#f7faf8",borderRadius:16,padding:16,margin:"16px 0"},methods:{display:"grid",gap:10,background:"#f7faf8",borderRadius:16,padding:15},method:{display:"flex",alignItems:"center",gap:10,fontWeight:800,padding:"8px 0"},primary:{width:"100%",border:0,borderRadius:15,padding:"15px 18px",background:"#20a957",color:"#fff",fontWeight:900,fontSize:17,marginTop:16},error:{padding:12,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700,margin:"12px 0"},ok:{padding:12,borderRadius:12,background:"#eaf8f0",color:"#168744",fontWeight:800,margin:"12px 0"}};

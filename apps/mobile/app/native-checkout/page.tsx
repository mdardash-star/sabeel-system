"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {nativePaymentsAvailable,startNativePayment,NativePaymentProvider} from "../payments/native-payment-bridge";

type Address={first_name?:string;last_name?:string;address_1?:string;address_2?:string;city?:string;state?:string;postcode?:string;country?:string;email?:string;phone?:string};
type Cart={items_count:number;billing_address?:Address;shipping_address?:Address;payment_methods?:string[];totals:{total_price:string;currency_code:string;currency_minor_unit:number;currency_symbol:string}};
type Method={gateway:string;provider:NativePaymentProvider;label:string};

function amount(value:string|undefined,minor=2){return Number(value||0)/10**minor}
async function readJson(response:Response){const p=await response.json().catch(()=>({}));if(!response.ok)throw new Error(p?.error||p?.message||"تعذر إكمال العملية");return p}
function providerFor(id:string):NativePaymentProvider{const x=id.toLowerCase();if(x.includes("amwal"))return"amwal";if(x.includes("tabby"))return"tabby";if(x.includes("tamara"))return"tamara";if(x.includes("apple"))return"apple_pay";if(x.includes("mada"))return"mada";if(x.includes("stc"))return"stc_pay";if(x.includes("tap"))return"tap";return"cards"}
function labelFor(id:string){const x=id.toLowerCase();if(x.includes("amwal"))return"أموال";if(x.includes("tabby"))return"تابي";if(x.includes("tamara"))return"تمارا";if(x.includes("apple"))return"Apple Pay";if(x.includes("mada"))return"مدى";if(x.includes("stc"))return"STC Pay";if(x.includes("tap"))return"Tap";return id.replace(/[_-]+/g," ")}
function sleep(ms:number){return new Promise(r=>setTimeout(r,ms))}
function normalizedStatus(value:string){const s=(value||"").toLowerCase();if(["processing","completed"].includes(s))return"paid";if(["failed"].includes(s))return"failed";if(["cancelled","refunded"].includes(s))return"cancelled";return"pending"}

export default function NativeCheckout(){
 const router=useRouter();
 const [methods,setMethods]=useState<Method[]>([]),[cart,setCart]=useState<Cart|null>(null),[selected,setSelected]=useState<string>(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState("");
 useEffect(()=>{(async()=>{try{const cp=await readJson(await fetch("/api/store/cart",{cache:"no-store"}));const ms=(cp.payment_methods||[]).map((gateway:string)=>({gateway,provider:providerFor(gateway),label:labelFor(gateway)}));setMethods(ms);setSelected(ms[0]?.gateway||"");setCart(cp)}catch{setError("تعذر تجهيز وسائل الدفع")}})()},[]);
 const total=useMemo(()=>cart?amount(cart.totals.total_price,cart.totals.currency_minor_unit):0,[cart]);
 async function verifyOrder(orderId:string,orderKey:string,email:string){let last="pending";for(let i=0;i<10;i++){const q=new URLSearchParams({key:orderKey});if(email)q.set("billing_email",email);const r=await fetch(`/api/store/order/${encodeURIComponent(orderId)}?${q.toString()}`,{cache:"no-store"});if(r.ok){const order=await r.json();last=normalizedStatus(String(order?.status||""));if(last!=="pending")return last}await sleep(1500)}return last}
 async function pay(){
   if(!selected||!cart)return;
   if(!nativePaymentsAvailable()){setError("الدفع الداخلي متاح من تطبيق سبيل المثبت فقط");return}
   setBusy(true);setError("");setResult("");
   try{
     const billing=cart.billing_address||{};const shipping=cart.shipping_address||{};
     if(!billing.email||!billing.phone||!billing.address_1)throw new Error("ارجع للمتجر وأكمل بيانات التوصيل أولًا");
     const checkout=await readJson(await fetch("/api/store/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({billing_address:billing,shipping_address:shipping,payment_method:selected,payment_data:[],expected_total:cart.totals.total_price})}));
     const orderId=String(checkout?.order_id||"");const orderKey=String(checkout?.order_key||"");
     if(!orderId||!orderKey)throw new Error("تعذر قراءة بيانات الطلب بعد إنشائه");
     const target=await readJson(await fetch("/api/payment-target",{cache:"no-store"}));
     const method=methods.find(m=>m.gateway===selected)||{gateway:selected,provider:providerFor(selected),label:labelFor(selected)};
     const customer={name:[billing.first_name,billing.last_name].filter(Boolean).join(" ")||"عميل سبيل",email:billing.email||"",phone:billing.phone||""};
     const nativeResult=await startNativePayment({provider:method.provider,orderId,amount:total,currency:"SAR",customer,session:{providerReference:orderKey,checkoutUrl:String(target.url||""),status:String(checkout?.status||"pending"),mode:"woocommerce_plugin"}});
     if(nativeResult.status==="cancelled"){setResult(`تم إلغاء عملية الدفع للطلب رقم ${orderId}`);return}
     const status=await verifyOrder(orderId,orderKey,billing.email||"");
     if(status==="paid")setResult(`تم الدفع بنجاح للطلب رقم ${orderId}`);
     else if(status==="cancelled")setResult(`تم إلغاء عملية الدفع للطلب رقم ${orderId}`);
     else if(status==="failed")setError(`فشلت عملية الدفع للطلب رقم ${orderId}`);
     else setResult(`الطلب رقم ${orderId} قيد التحقق من الدفع`);
   }catch(e){setError(e instanceof Error?e.message:"تعذر إتمام الدفع")}finally{setBusy(false)}
 }
 return <main style={s.page} dir="rtl"><section style={s.card}><button style={s.back} onClick={()=>router.replace("/store")}>رجوع</button><small style={s.kicker}>سبيل</small><h1 style={s.title}>الدفع داخل التطبيق</h1><p style={s.note}>اختر وسيلة الدفع. يتم فتح بوابة الدفع الرسمية داخل تطبيق سبيل، بينما يبقى إنشاء الطلب وتأكيده لدى WooCommerce.</p>{cart&&<div style={s.summary}><span>عدد القطع</span><b>{cart.items_count}</b><span>الإجمالي</span><b>{total.toLocaleString("ar-SA",{maximumFractionDigits:2})} {cart.totals.currency_symbol||"ر.س"}</b></div>}{error&&<div style={s.error}>{error}</div>}{result&&<div style={s.ok}>{result}</div>}<section style={s.methods}><b>وسيلة الدفع</b>{methods.length?methods.map(m=><label key={m.gateway} style={s.method}><input type="radio" name="native-payment" checked={selected===m.gateway} onChange={()=>setSelected(m.gateway)}/><span>{m.label}</span></label>):<p style={s.note}>لا توجد وسائل دفع متاحة لهذا الطلب. ارجع للمتجر وحدّث بيانات التوصيل.</p>}</section><button style={s.primary} disabled={busy||!selected||!cart?.items_count} onClick={pay}>{busy?"جاري بدء الدفع":"الدفع الآن"}</button></section></main>
}

const s:Record<string,React.CSSProperties>={page:{minHeight:"100vh",background:"#f4f7f6",padding:16,fontFamily:"inherit"},card:{maxWidth:680,margin:"0 auto",background:"#fff",borderRadius:22,padding:18,boxShadow:"0 12px 36px rgba(0,0,0,.06)"},back:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:10,padding:"9px 12px",fontWeight:800,marginBottom:14},kicker:{color:"#20a957",fontWeight:800},title:{margin:"4px 0 6px",fontSize:26},note:{color:"#6b7280",lineHeight:1.7},summary:{display:"grid",gridTemplateColumns:"1fr auto",gap:"10px 16px",background:"#f7faf8",borderRadius:16,padding:16,margin:"16px 0"},methods:{display:"grid",gap:10,background:"#f7faf8",borderRadius:16,padding:15},method:{display:"flex",alignItems:"center",gap:10,fontWeight:800,padding:"8px 0"},primary:{width:"100%",border:0,borderRadius:15,padding:"15px 18px",background:"#20a957",color:"#fff",fontWeight:900,fontSize:17,marginTop:16},error:{padding:12,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700,margin:"12px 0"},ok:{padding:12,borderRadius:12,background:"#eaf8f0",color:"#168744",fontWeight:800,margin:"12px 0"}};

"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";

type Method={id:string;label:string;enabled:boolean;status:"ready"|"needs_configuration";missing:string[];mode:string};
type Payload={status:"ready"|"partial"|"not_ready";ready_count:number;total_count:number;methods:Method[];source?:string;architecture?:string};

export default function PaymentReadiness(){
 const router=useRouter();
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState("");
 useEffect(()=>{void load()},[]);
 async function load(){
  setError("");
  try{
   const r=await fetch("/api/payments/methods",{cache:"no-store"});
   const p=await r.json();
   if(!r.ok)throw new Error(p?.error||"تعذر قراءة حالة البوابات");
   setData(p);
  }catch(e){setError(e instanceof Error?e.message:"تعذر قراءة حالة البوابات")}
 }
 const summary=useMemo(()=>data?.status==="ready"?"الدفع داخل التطبيق جاهز عبر WooCommerce":data?.status==="partial"?"الاتصال بوسائل الدفع يحتاج إعادة فحص":"جاري الفحص",[data]);
 return <main style={s.page} dir="rtl"><section style={s.card}>
  <div style={s.head}><button style={s.back} onClick={()=>router.back()}>رجوع</button><div><small style={s.kicker}>SUBIL OS</small><h1 style={s.title}>جاهزية بوابات الدفع</h1><p style={s.note}>يعتمد التطبيق على بوابات WooCommerce المفعلة في المتجر، وتُفتح عملية الدفع داخل Native WebView بدون تخزين مفاتيح البوابات في Render.</p></div></div>
  {error&&<div style={s.error}>{error}<button style={s.retry} onClick={load}>إعادة الفحص</button></div>}
  {!data&&!error?<div style={s.loading}>جاري فحص وسائل الدفع المتاحة للسلة الحالية</div>:null}
  {data?<><div style={s.summary}><b>{summary}</b><span>{data.ready_count} وسيلة دفع متاحة للسلة الحالية</span><button style={s.refresh} onClick={load}>تحديث الحالة</button></div>
  {data.methods.length?<div style={s.grid}>{data.methods.map(m=><article key={m.id} style={s.method}>
   <div style={s.methodHead}><b style={s.methodName}>{m.label}</b><span style={s.ready}>جاهزة</span></div>
   <p style={s.okText}>WooCommerce يدير الجلسة والبوابة، والتطبيق يفتحها داخل نافذة الدفع الأصلية.</p>
  </article>)}</div>:<div style={s.empty}>لا توجد وسيلة دفع مؤهلة للسلة الحالية بعد. أكمل بيانات التوصيل أو أضف منتجًا للسلة ثم أعد الفحص.</div>}</>:null}
 </section></main>
}

const s:Record<string,React.CSSProperties>={
 page:{minHeight:"100vh",background:"#f4f7f6",padding:16,fontFamily:"inherit"},card:{maxWidth:760,margin:"0 auto",background:"#fff",borderRadius:22,padding:18,boxShadow:"0 12px 36px rgba(0,0,0,.06)"},head:{display:"flex",gap:12,alignItems:"flex-start"},back:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:10,padding:"9px 12px",fontWeight:800},kicker:{color:"#20a957",fontWeight:800},title:{margin:"4px 0 6px",fontSize:26},note:{color:"#6b7280",lineHeight:1.7,margin:"4px 0"},summary:{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",background:"#f7faf8",borderRadius:16,padding:16,margin:"18px 0"},refresh:{gridColumn:"1 / -1",border:0,borderRadius:12,padding:"11px 14px",background:"#eef7f2",fontWeight:800},grid:{display:"grid",gap:12},method:{border:"1px solid #e5e9e7",borderRadius:16,padding:15},methodHead:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12},methodName:{fontSize:17},ready:{background:"#eaf8f0",color:"#168744",padding:"5px 9px",borderRadius:999,fontSize:12,fontWeight:900},okText:{color:"#168744",marginBottom:0},error:{marginTop:16,padding:14,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700},retry:{marginRight:10,border:0,borderRadius:8,padding:"6px 10px"},loading:{padding:32,textAlign:"center",color:"#6b7280"},empty:{padding:18,borderRadius:14,background:"#fff8e8",color:"#8a5a00",lineHeight:1.7}
};

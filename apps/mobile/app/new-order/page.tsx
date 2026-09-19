"use client";

import {FormEvent,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
const demoMode=process.env.NEXT_PUBLIC_SUBIL_DEMO_MODE==="true";
const services=[
  {id:"filter_change",name:"تغيير فلاتر",note:"صيانة دورية واستبدال الفلاتر"},
  {id:"device_install",name:"تركيب جهاز تحلية",note:"تركيب وتشغيل جهاز التحلية"},
  {id:"device_maintenance",name:"صيانة جهاز التحلية",note:"فحص الأعطال والصيانة"},
  {id:"tank_cleaning",name:"تنظيف وتعقيم خزان",note:"تنظيف وتعقيم الخزان"},
  {id:"water_check",name:"فحص جودة المياه",note:"فحص جودة المياه في الموقع"},
  {id:"other",name:"خدمة أخرى",note:"اكتب تفاصيل الخدمة في الملاحظات"}
];

export default function NewOrder(){
  const router=useRouter();
  const [service,setService]=useState(services[0].id),[address,setAddress]=useState(""),[date,setDate]=useState(""),[time,setTime]=useState(""),[notes,setNotes]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState<{number:string;service:string}|null>(null);
  useEffect(()=>{if(!sessionStorage.getItem("subil_customer_session"))router.replace("/login")},[router]);
  const selected=useMemo(()=>services.find(x=>x.id===service)!,[service]);
  async function submit(e:FormEvent){e.preventDefault();setError("");if(address.trim().length<5)return setError("أدخل عنوانًا واضحًا للخدمة");if(!date||!time)return setError("حدد التاريخ والوقت المناسبين");setBusy(true);try{
    const scheduledAt=new Date(`${date}T${time}:00`).toISOString();
    if(demoMode&&!apiBase){const number=`D-${String(Date.now()).slice(-6)}`;localStorage.setItem("subil_demo_last_order",JSON.stringify({number,service:selected.name,address,scheduledAt,notes,createdAt:new Date().toISOString()}));setDone({number,service:selected.name});return;}
    const token=sessionStorage.getItem("subil_customer_session")||"";
    const r=await fetch(`${apiBase}/api/v1/customers/me/service-orders`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({serviceType:selected.name,addressText:address,cityId:"riyadh",scheduledAt,notes})});
    const p=await r.json();if(!r.ok)throw new Error(p.error||"تعذر إنشاء الطلب");setDone({number:p.order?.external_order_id||p.job?.id||"-",service:selected.name});
  }catch(err){setError(err instanceof Error?err.message:"تعذر إنشاء الطلب")}finally{setBusy(false)}}
  if(done)return <main style={s.page}><section style={s.card}><div style={s.success}>✓</div><h1 style={s.title}>تم استلام طلبك</h1><p style={s.muted}>سيظهر الطلب في حسابك ويتم إسناده للفني المناسب.</p><div style={s.summary}><span>رقم الطلب</span><b>{done.number}</b><span>الخدمة</span><b>{done.service}</b></div><button style={s.primary} onClick={()=>router.replace("/")}>العودة للرئيسية</button></section></main>;
  return <main style={s.page}><section style={s.card}><div style={s.head}><button style={s.back} onClick={()=>router.back()}>‹</button><div><small style={s.kicker}>طلب جديد</small><h1 style={s.title}>اطلب الخدمة من التطبيق</h1><p style={s.muted}>بدون الانتقال للمتجر أو فتح صفحة أخرى.</p></div></div><form onSubmit={submit} style={s.form}>
    <label style={s.label}>نوع الخدمة<select style={s.input} value={service} onChange={e=>setService(e.target.value)}>{services.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><small style={s.help}>{selected.note}</small></label>
    <label style={s.label}>عنوان الخدمة<textarea style={{...s.input,minHeight:82,resize:"vertical"}} value={address} onChange={e=>setAddress(e.target.value)} placeholder="مثال: الرياض - حي الملقا - شارع ..."/></label>
    <div style={s.row}><label style={s.label}>التاريخ<input style={s.input} type="date" value={date} onChange={e=>setDate(e.target.value)} min={new Date().toISOString().slice(0,10)}/></label><label style={s.label}>الوقت<input style={s.input} type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div>
    <label style={s.label}>ملاحظات إضافية<textarea style={{...s.input,minHeight:70,resize:"vertical"}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="أي تفاصيل تساعد الفني..."/></label>
    {error&&<div style={s.error}>{error}</div>}
    <button style={s.primary} disabled={busy}>{busy?"جارٍ إنشاء الطلب…":"تأكيد الطلب"}</button>
    <p style={s.note}>بعد التأكيد يمكنك متابعة حالة الطلب من داخل التطبيق.</p>
  </form></section></main>;
}

const s:Record<string,React.CSSProperties>={page:{minHeight:"100vh",background:"#f4f7f6",padding:"20px",fontFamily:"inherit"},card:{maxWidth:520,margin:"0 auto",background:"#fff",borderRadius:24,padding:22,boxShadow:"0 14px 40px rgba(0,0,0,.07)"},head:{display:"flex",gap:14,alignItems:"flex-start",marginBottom:22},back:{width:42,height:42,borderRadius:14,border:"1px solid #e5e7eb",background:"#fff",fontSize:28,cursor:"pointer"},kicker:{color:"#20a957",fontWeight:800},title:{margin:"4px 0 6px",fontSize:26},muted:{margin:0,color:"#6b7280",lineHeight:1.7},form:{display:"grid",gap:16},label:{display:"grid",gap:7,fontWeight:700,color:"#1f2937"},input:{width:"100%",boxSizing:"border-box",border:"1px solid #dfe5e2",borderRadius:14,padding:"13px 14px",fontSize:16,background:"#fff",fontFamily:"inherit"},help:{fontWeight:400,color:"#6b7280"},row:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12},primary:{border:0,borderRadius:15,padding:"15px 18px",background:"#20a957",color:"#fff",fontSize:17,fontWeight:800,cursor:"pointer"},note:{textAlign:"center",color:"#6b7280",fontSize:13,margin:0},error:{padding:12,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700},success:{width:64,height:64,borderRadius:22,display:"grid",placeItems:"center",background:"#eaf8f0",color:"#20a957",fontSize:34,fontWeight:900,margin:"4px auto 14px"},summary:{display:"grid",gridTemplateColumns:"1fr auto",gap:"10px 16px",background:"#f7faf8",borderRadius:16,padding:16,margin:"20px 0",color:"#374151"}};

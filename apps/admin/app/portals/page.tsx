"use client";
import{useEffect,useState}from"react";
type Role="admin"|"supervisor"|"provider";
const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type JobStats={open:number;scheduled_today:number;in_progress:number;overdue:number;completed_today:number};
type TechStats={total:number};
type Profit={summary:{order_count:number;revenue:number|string}};
const jobStatsSeed:JobStats={open:24,scheduled_today:24,in_progress:12,overdue:3,completed_today:18};
const techStatsSeed:TechStats={total:12};
const profitSeed:Profit={summary:{order_count:138,revenue:84500}};
const money=(v:number|string)=>Number(v||0).toLocaleString("ar-SA",{maximumFractionDigits:0});
const actions={admin:["إدارة المستخدمين والصلاحيات","المالية والتسويات","الموردون والعقود","التقارير الشاملة"],supervisor:["توزيع ومتابعة المهام","مراقبة الفنيين","اعتماد الإغلاق","الجودة والشكاوى"],provider:["استلام المهام","إدارة فريق الكيان","رفع إثبات الإنجاز","الفواتير والمستحقات"]} as const;
const copy={admin:{title:"لوحة الإدارة العليا",desc:"إدارة المنصة بالكامل"},supervisor:{title:"لوحة المشرفين",desc:"الإشراف على التشغيل والجودة"},provider:{title:"بوابة مورد الخدمة",desc:"مخصصة للكيانات المتعاقدة مع سبيل"}} as const;

export default function Portals(){
  const[role,setRole]=useState<Role>("admin");
  const[jobStats,setJobStats]=useState<JobStats>(jobStatsSeed);
  const[jobsAllowed,setJobsAllowed]=useState(!apiBase);
  const[techStats,setTechStats]=useState<TechStats>(techStatsSeed);
  const[techAllowed,setTechAllowed]=useState(!apiBase);
  const[profit,setProfit]=useState<Profit>(profitSeed);
  const[revenueAllowed,setRevenueAllowed]=useState(!apiBase);

  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),headers={Authorization:`Bearer ${token}`};
    const to=new Date(),from=new Date(to.getTime()-29*86400000),range=new URLSearchParams({from:from.toISOString(),to:to.toISOString()});
    fetch(`${apiBase}/api/v1/jobs/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setJobsAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setJobStats(p.stats);setJobsAllowed(true)}}).catch(()=>{});
    fetch(`${apiBase}/api/v1/technicians/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setTechAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setTechStats(p.stats);setTechAllowed(true)}}).catch(()=>{});
    fetch(`${apiBase}/api/v1/reports/profitability?${range}`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setRevenueAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p){setProfit(p);setRevenueAllowed(true)}}).catch(()=>{});
    return()=>controller.abort();
  },[]);

  const cards:Record<Role,Array<[string,string]>>={
    admin:[["إجمالي الطلبات (٣٠ يوم)",revenueAllowed?Number(profit.summary.order_count).toLocaleString("ar-SA"):"—"],["الإيرادات (٣٠ يوم)",revenueAllowed?`${money(profit.summary.revenue)} ر.س`:"—"],["مزودو خدمة",techAllowed?techStats.total.toLocaleString("ar-SA"):"—"],["المهام المفتوحة",jobsAllowed?jobStats.open.toLocaleString("ar-SA"):"—"]],
    supervisor:[["مهام مجدولة اليوم",jobsAllowed?jobStats.scheduled_today.toLocaleString("ar-SA"):"—"],["قيد التنفيذ",jobsAllowed?jobStats.in_progress.toLocaleString("ar-SA"):"—"],["متأخرة",jobsAllowed?jobStats.overdue.toLocaleString("ar-SA"):"—"],["مكتملة اليوم",jobsAllowed?jobStats.completed_today.toLocaleString("ar-SA"):"—"]],
    provider:[["مهام الكيان","—"],["جديدة","—"],["قيد التنفيذ","—"],["مستحقات","—"]],
  };
  const x={...copy[role],cards:cards[role],actions:actions[role]};

  return <main style={s.page} dir="rtl"><section style={s.shell}><header style={s.head}><div><small style={s.kicker}>منصة سبيل</small><h1 style={s.h1}>مراكز التحكم</h1><p style={s.muted}>واجهة وصلاحيات مستقلة حسب نوع المستخدم والكيان.</p></div><a href="/" style={s.back}>العودة</a></header><div style={s.tabs}>{([["admin","الإدارة"],["supervisor","المشرفون"],["provider","مورد الخدمة"]] as const).map(([id,label])=><button key={id} onClick={()=>setRole(id)} style={{...s.tab,...(role===id?s.on:{})}}>{label}</button>)}</div><section style={s.hero}><small>{x.desc}</small><h2>{x.title}</h2><p>لا يظهر للمستخدم إلا البيانات والعمليات المصرح بها لدوره وكيانه.</p></section><div style={s.cards}>{x.cards.map(([a,b])=><article style={s.card} key={a}><span>{a}</span><strong>{b}</strong></article>)}</div><h3>الصلاحيات الرئيسية</h3><div style={s.actions}>{x.actions.map(a=><article key={a}><b>{a}</b><span>فتح الوحدة ‹</span></article>)}</div>{role==="provider"&&<section style={s.entity}><b>عزل بيانات الكيان — نموذج تصوري لميزة مستقبلية</b><p>مورد الخدمة يرى مهامه وفريقه ومستحقاته فقط، ولا يمكنه الوصول إلى عملاء أو موردين أو بيانات مالية خارج نطاق كيانه. هذه البوابة قيد التطوير ولا يوجد بعد نموذج بيانات للكيانات المتعاقدة، لذا لا تُعرض أرقام هنا.</p></section>}</section></main>}
const s:Record<string,React.CSSProperties>={page:{minHeight:"100vh",background:"#f4f7f6",padding:18},shell:{maxWidth:1050,margin:"0 auto"},head:{display:"flex",justifyContent:"space-between",gap:15,alignItems:"flex-start"},kicker:{color:"#20a957",fontWeight:900},h1:{margin:"4px 0",fontSize:30},muted:{margin:0,color:"#6b7280"},back:{background:"#fff",border:"1px solid #e2e8e5",borderRadius:12,padding:"10px 14px",textDecoration:"none",color:"#111827",fontWeight:800},tabs:{display:"flex",gap:8,margin:"22px 0"},tab:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:12,padding:"11px 18px",fontWeight:800},on:{background:"#0f3d2d",color:"#fff",borderColor:"#0f3d2d"},hero:{background:"#0f3d2d",color:"#fff",borderRadius:22,padding:24},cards:{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:12,margin:"14px 0 22px"},card:{background:"#fff",border:"1px solid #e8eeeb",borderRadius:16,padding:17,display:"grid",gap:8},actions:{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10},entity:{background:"#fff8e8",borderRadius:16,padding:17,marginTop:15},};

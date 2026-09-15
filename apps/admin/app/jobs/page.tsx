"use client";

import { useEffect, useMemo, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type JobFilter="all"|"open"|"pending_assignment"|"scheduled"|"active"|"overdue"|"completed"|"cancelled";
type JobStats={open:number;pending_assignment:number;scheduled_today:number;in_progress:number;overdue:number;completed_today:number};
type Job={id:string;external_order_id?:string;customer_id:string;customer_name:string;customer_mobile?:string;city_id?:string;address_text?:string;technician_id?:string;required_skill_code?:string;service_duration_minutes?:number;status:string;scheduled_at?:string;created_at:string;sla_state:"unassigned"|"overdue"|"on_track";minutes_late:number};

const seed:Job[]=[
  {id:"JOB-1049",external_order_id:"1049",customer_id:"CUS-1047",customer_name:"نورة الدوسري",customer_mobile:"053 761 4280",city_id:"الرياض",address_text:"حي الملقا",required_skill_code:"ro-maintenance",service_duration_minutes:60,status:"pending_assignment",created_at:"2026-09-15T07:20:00Z",sla_state:"unassigned",minutes_late:0},
  {id:"JOB-1048",external_order_id:"1048",customer_id:"CUS-1048",customer_name:"محمد القحطاني",customer_mobile:"055 482 1930",city_id:"الرياض",address_text:"حي الياسمين",technician_id:"TECH-12",required_skill_code:"ro-install",service_duration_minutes:90,status:"en_route",scheduled_at:"2026-09-15T08:30:00Z",created_at:"2026-09-14T14:00:00Z",sla_state:"overdue",minutes_late:35},
  {id:"JOB-1046",external_order_id:"1046",customer_id:"CUS-1046",customer_name:"شركة روافد",customer_mobile:"011 452 7300",city_id:"الرياض",address_text:"حي السليمانية",technician_id:"TECH-08",required_skill_code:"jumbo",service_duration_minutes:120,status:"scheduled",scheduled_at:"2026-09-15T12:30:00Z",created_at:"2026-09-13T10:00:00Z",sla_state:"on_track",minutes_late:0},
  {id:"JOB-1045",external_order_id:"1045",customer_id:"CUS-1045",customer_name:"سعد العتيبي",customer_mobile:"050 339 8124",city_id:"الرياض",address_text:"حي قرطبة",technician_id:"TECH-04",required_skill_code:"tank-cleaning",service_duration_minutes:90,status:"completed",scheduled_at:"2026-09-15T06:00:00Z",created_at:"2026-09-12T11:00:00Z",sla_state:"on_track",minutes_late:0}
];
const initialStats:JobStats={open:3,pending_assignment:1,scheduled_today:2,in_progress:1,overdue:1,completed_today:1};
const dateTimeFormatter=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short"});
function dateTime(value?:string){return value?dateTimeFormatter.format(new Date(value)):"غير مجدولة";}
function statusLabel(value:string){return({pending_assignment:"بانتظار الإسناد",scheduled:"مجدولة",en_route:"في الطريق",arrived:"وصل الفني",in_progress:"قيد التنفيذ",completed:"مكتملة",cancelled:"ملغاة"} as Record<string,string>)[value]||value;}
function statusClass(value:string){return value==="completed"?"done":value==="en_route"?"enroute":value==="arrived"||value==="in_progress"?"working":"scheduled";}
function matches(job:Job,filter:JobFilter){if(filter==="all")return true;if(filter==="open")return!["completed","cancelled"].includes(job.status);if(filter==="active")return["en_route","arrived","in_progress"].includes(job.status);if(filter==="overdue")return job.sla_state==="overdue";return job.status===filter;}

export default function JobsPage(){
  const [jobs,setJobs]=useState<Job[]>(apiBase?[]:seed);
  const [stats,setStats]=useState<JobStats>(initialStats);
  const [filter,setFilter]=useState<JobFilter>("open");
  const [query,setQuery]=useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [total,setTotal]=useState(apiBase?0:seed.length);
  const [loading,setLoading]=useState(Boolean(apiBase));
  const [error,setError]=useState("");
  const shown=useMemo(()=>{if(apiBase)return jobs;const q=query.trim().toLowerCase();return seed.filter(job=>matches(job,filter)&&(!q||[job.external_order_id,job.customer_name,job.customer_mobile,job.address_text,job.technician_id].some(value=>value?.toLowerCase().includes(q))));},[jobs,query,filter]);
  const displayTotal=apiBase?total:shown.length;

  useEffect(()=>{if(!apiBase)return;const timer=window.setTimeout(()=>{setPage(0);setSearch(query.trim());},300);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{
    if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),params=new URLSearchParams({status:filter,limit:"20",offset:String(page*20)});if(search)params.set("q",search);setLoading(true);
    fetch(`${apiBase}/api/v1/jobs?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(response.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل المهام.");return response.json();})
      .then(payload=>{setJobs(payload.jobs||[]);setTotal(Number(payload.pagination?.total||0));setError("");})
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل المهام.");})
      .finally(()=>setLoading(false));return()=>controller.abort();
  },[filter,page,search]);
  useEffect(()=>{
    if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session");fetch(`${apiBase}/api/v1/jobs/stats`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("تعذر تحميل مؤشرات المهام.");return response.json();}).then(payload=>setStats(payload.stats))
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل مؤشرات المهام.");});return()=>controller.abort();
  },[]);
  function changeFilter(value:JobFilter){setFilter(value);setPage(0);}

  const cards:Array<{label:string;value:number;filter:JobFilter;tone?:string}>=[
    {label:"المهام المفتوحة",value:stats.open,filter:"open"},{label:"بانتظار الإسناد",value:stats.pending_assignment,filter:"pending_assignment",tone:"amber"},{label:"مجدولة اليوم",value:stats.scheduled_today,filter:"scheduled"},{label:"قيد التنفيذ",value:stats.in_progress,filter:"active",tone:"blue"},{label:"متأخرة",value:stats.overdue,filter:"overdue",tone:"red"},{label:"مكتملة اليوم",value:stats.completed_today,filter:"completed",tone:"green"}
  ];
  return <PreviewAuthGuard><main className="customers-page jobs-page"><header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><nav className="section-nav" aria-label="تنقل الأقسام"><a href="/">لوحة التحكم</a><a className="active" href="/jobs">المهام</a><a href="/customers">العملاء</a><a href="/maintenance">الصيانة</a></nav><div className="profile-avatar">م</div></header><div className="customers-wrap">
    <div className="demo-notice"><span>نسخة المعاينة</span> بيانات التشغيل تجريبية ولا تؤثر على متجر سبيل المباشر.</div>
    <div className="page-head"><div><p>التشغيل الميداني</p><h1>الطلبات والمهام</h1><span>متابعة الإسناد والجدولة والتنفيذ ومستوى الالتزام بالمواعيد</span></div></div>
    <section className="ops-stats" aria-label="مؤشرات المهام">{cards.map(card=><button key={card.label} className={`${card.tone||""}${filter===card.filter?" active":""}`} onClick={()=>changeFilter(card.filter)}><span>{card.label}</span><strong>{Number(card.value||0).toLocaleString("ar-SA")}</strong></button>)}</section>
    {error&&<div className="api-error" role="alert">{error}</div>}
    <section className="panel jobs-worklist"><div className="customers-toolbar"><div><h2>قائمة المهام</h2><p>{loading?"جارٍ تحميل المهام...":`${displayTotal.toLocaleString("ar-SA")} مهمة في النطاق المحدد`}</p></div><div className="jobs-toolbar-actions"><select value={filter} onChange={event=>changeFilter(event.target.value as JobFilter)} aria-label="تصفية حالة المهمة"><option value="open">المهام المفتوحة</option><option value="all">جميع الحالات</option><option value="pending_assignment">بانتظار الإسناد</option><option value="scheduled">مجدولة</option><option value="active">قيد التنفيذ</option><option value="overdue">متأخرة</option><option value="completed">مكتملة</option><option value="cancelled">ملغاة</option></select><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="ابحث برقم الطلب أو العميل أو الموقع أو الفني" aria-label="بحث في المهام"/></div></div>
      {shown.length?<><div className="table-wrap"><table><thead><tr><th>الطلب والعميل</th><th>الموقع</th><th>الموعد</th><th>الفني</th><th>الحالة</th><th>الالتزام</th></tr></thead><tbody>{shown.map(job=><tr key={job.id}><td><a className="customer-name-link" href={`/customers/${encodeURIComponent(job.customer_id)}`}><strong>#{job.external_order_id||job.id} · {job.customer_name}</strong><small dir="ltr">{job.customer_mobile||"—"}</small></a></td><td><strong>{job.address_text||"—"}</strong><small>{job.city_id||"—"}</small></td><td><strong>{dateTime(job.scheduled_at)}</strong><small>{Number(job.service_duration_minutes||60).toLocaleString("ar-SA")} دقيقة</small></td><td><strong>{job.technician_id||"لم يُسند"}</strong><small>{job.required_skill_code||"مهارة عامة"}</small></td><td><span className={`status ${statusClass(job.status)}`}>{statusLabel(job.status)}</span></td><td><span className={`sla-badge ${job.sla_state}`}>{job.sla_state==="unassigned"?"يحتاج إسناد":job.sla_state==="overdue"?`متأخرة ${Number(job.minutes_late||0).toLocaleString("ar-SA")} د`:"ضمن الموعد"}</span></td></tr>)}</tbody></table></div>{apiBase&&total>20&&<nav className="customers-pagination" aria-label="صفحات المهام"><button className="secondary-button" disabled={loading||page===0} onClick={()=>setPage(value=>value-1)}>السابق</button><span>صفحة {(page+1).toLocaleString("ar-SA")} من {Math.ceil(total/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={loading||(page+1)*20>=total} onClick={()=>setPage(value=>value+1)}>التالي</button></nav>}</>:<div className="empty-state">لا توجد مهام مطابقة.</div>}
    </section>
  </div></main></PreviewAuthGuard>;
}

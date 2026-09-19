"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type JobFilter="all"|"open"|"pending_assignment"|"scheduled"|"active"|"overdue"|"completed"|"cancelled";
type JobStats={open:number;pending_assignment:number;scheduled_today:number;in_progress:number;overdue:number;completed_today:number};
type Job={id:string;external_order_id?:string;customer_id:string;customer_name:string;customer_mobile?:string;city_id?:string;address_text?:string;technician_id?:string;required_skill_code?:string;service_duration_minutes?:number;status:string;scheduled_at?:string;created_at:string;sla_state:"unassigned"|"overdue"|"on_track";minutes_late:number};
type Candidate={technician_id:string;distance_km?:string;jobs_in_window:number;avg_rating:string};

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
function localDateTime(value?:string){const date=value?new Date(value):new Date(Date.now()+24*60*60*1000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16);}

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
  const [reloadKey,setReloadKey]=useState(0);
  const [dispatchJob,setDispatchJob]=useState<Job|null>(null);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [candidateLoading,setCandidateLoading]=useState(false);
  const [dispatchSaving,setDispatchSaving]=useState(false);
  const [dispatchError,setDispatchError]=useState("");
  const [escalationOpen,setEscalationOpen]=useState(apiBase?0:1);
  const [escalationRunning,setEscalationRunning]=useState(false);
  const shown=useMemo(()=>{if(apiBase)return jobs;const q=query.trim().toLowerCase();return jobs.filter(job=>matches(job,filter)&&(!q||[job.external_order_id,job.customer_name,job.customer_mobile,job.address_text,job.technician_id].some(value=>value?.toLowerCase().includes(q))));},[jobs,query,filter]);
  const displayTotal=apiBase?total:shown.length;

  useEffect(()=>{if(!apiBase)return;const timer=window.setTimeout(()=>{setPage(0);setSearch(query.trim());},300);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{
    if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),params=new URLSearchParams({status:filter,limit:"20",offset:String(page*20)});if(search)params.set("q",search);setLoading(true);
    fetch(`${apiBase}/api/v1/jobs?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(response.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل المهام.");return response.json();})
      .then(payload=>{setJobs(payload.jobs||[]);setTotal(Number(payload.pagination?.total||0));setError("");})
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل المهام.");})
      .finally(()=>setLoading(false));return()=>controller.abort();
  },[filter,page,search,reloadKey]);
  useEffect(()=>{
    if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session");fetch(`${apiBase}/api/v1/jobs/stats`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("تعذر تحميل مؤشرات المهام.");return response.json();}).then(payload=>setStats(payload.stats))
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل مؤشرات المهام.");});return()=>controller.abort();
  },[reloadKey]);
  useEffect(()=>{if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session");fetch(`${apiBase}/api/v1/jobs/escalations/stats`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async response=>response.ok?response.json():Promise.reject(new Error("تعذر تحميل التصعيد."))).then(payload=>setEscalationOpen(Number(payload.stats?.open||0))).catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;});return()=>controller.abort();},[reloadKey]);
  function changeFilter(value:JobFilter){setFilter(value);setPage(0);}
  async function openDispatch(job:Job){
    setDispatchJob(job);setDispatchError("");setCandidates([]);setCandidateLoading(true);
    if(!apiBase){setCandidates([{technician_id:"TECH-12",distance_km:"2.4",jobs_in_window:1,avg_rating:"4.9"},{technician_id:"TECH-08",distance_km:"5.1",jobs_in_window:0,avg_rating:"4.7"}]);setCandidateLoading(false);return;}
    try{const token=sessionStorage.getItem("subil_session"),response=await fetch(`${apiBase}/api/v1/jobs/${encodeURIComponent(job.id)}/candidates?limit=10`,{headers:{Authorization:`Bearer ${token}`}}),payload=await response.json();if(!response.ok)throw new Error(payload.error==="job_not_dispatchable"?"هذه المهمة لم تعد قابلة للإسناد.":"تعذر تحميل الفنيين المتاحين.");setCandidates(payload.candidates||[]);}
    catch(reason){setDispatchError(reason instanceof Error?reason.message:"تعذر تحميل الفنيين المتاحين.");}finally{setCandidateLoading(false);}
  }
  async function saveDispatch(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!dispatchJob)return;const data=new FormData(event.currentTarget),technicianId=String(data.get("technicianId")||""),scheduledAt=String(data.get("scheduledAt")||""),serviceDurationMinutes=Number(data.get("serviceDurationMinutes")||60),reason=String(data.get("reason")||"").trim(),reassign=dispatchJob.status==="scheduled";
    if(!technicianId||!scheduledAt||!Number.isInteger(serviceDurationMinutes)||serviceDurationMinutes<1||(reassign&&reason.length<3)){setDispatchError(reassign?"اختر الفني والموعد واكتب سبب إعادة الإسناد.":"اختر الفني والموعد ومدة الخدمة.");return;}setDispatchSaving(true);
    try{let updated:Job={...dispatchJob,technician_id:technicianId,scheduled_at:new Date(scheduledAt).toISOString(),service_duration_minutes:serviceDurationMinutes,status:"scheduled",sla_state:"on_track",minutes_late:0};if(apiBase){const token=sessionStorage.getItem("subil_session"),action=reassign?"reassign":"assign",response=await fetch(`${apiBase}/api/v1/jobs/${encodeURIComponent(dispatchJob.id)}/${action}`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({technicianId,scheduledAt,serviceDurationMinutes,reason:reassign?reason:undefined})}),payload=await response.json();if(!response.ok)throw new Error(payload.error==="schedule_conflict"?"الفني لديه مهمة متعارضة في هذا الموعد.":payload.error==="assignment_invalid"?"الفني غير متاح أو لا يملك المهارة المطلوبة.":"تعذر حفظ الإسناد.");updated={...updated,...payload.job};setReloadKey(value=>value+1);}else{setJobs(list=>list.map(job=>job.id===updated.id?updated:job));if(!reassign)setStats(value=>({...value,pending_assignment:Math.max(0,value.pending_assignment-1),scheduled_today:value.scheduled_today+1}));}setDispatchJob(null);setDispatchError("");}
    catch(reason){setDispatchError(reason instanceof Error?reason.message:"تعذر حفظ الإسناد.");}finally{setDispatchSaving(false);}
  }
  async function runEscalations(){setEscalationRunning(true);try{if(apiBase){const token=sessionStorage.getItem("subil_session"),response=await fetch(`${apiBase}/api/v1/jobs/escalations/run`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({limit:100})});if(!response.ok)throw new Error("تعذر تشغيل فحص التأخير.");setReloadKey(value=>value+1);}else setEscalationOpen(value=>Math.max(1,value));}catch(reason){setError(reason instanceof Error?reason.message:"تعذر تشغيل فحص التأخير.");}finally{setEscalationRunning(false);}}

  const cards:Array<{label:string;value:number;filter:JobFilter;tone?:string}>=[
    {label:"المهام المفتوحة",value:stats.open,filter:"open"},{label:"بانتظار الإسناد",value:stats.pending_assignment,filter:"pending_assignment",tone:"amber"},{label:"مجدولة اليوم",value:stats.scheduled_today,filter:"scheduled"},{label:"قيد التنفيذ",value:stats.in_progress,filter:"active",tone:"blue"},{label:"متأخرة",value:stats.overdue,filter:"overdue",tone:"red"},{label:"مكتملة اليوم",value:stats.completed_today,filter:"completed",tone:"green"}
  ];
  return <PreviewAuthGuard><main className="customers-page jobs-page"><header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><nav className="section-nav" aria-label="تنقل الأقسام"><a href="/">لوحة التحكم</a><a className="active" href="/jobs">المهام</a><a href="/customers">العملاء</a><a href="/technicians">الفنيون</a><a href="/maintenance">الصيانة</a><a href="/finance">المالية</a><a href="/inventory">المخزون</a></nav><div className="profile-avatar">م</div></header><div className="customers-wrap">
    <div className="demo-notice"><span>نسخة المعاينة</span> بيانات التشغيل تجريبية ولا تؤثر على متجر سبيل المباشر.</div>
    <div className="page-head"><div><p>التشغيل الميداني</p><h1>الطلبات والمهام</h1><span>متابعة الإسناد والجدولة والتنفيذ ومستوى الالتزام بالمواعيد</span></div><button className="primary-button sla-run-button" disabled={escalationRunning} onClick={runEscalations}><span>!</span>{escalationRunning?"جارٍ الفحص...":`فحص SLA · ${escalationOpen.toLocaleString("ar-SA")}`}</button></div>
    <section className="ops-stats" aria-label="مؤشرات المهام">{cards.map(card=><button key={card.label} className={`${card.tone||""}${filter===card.filter?" active":""}`} onClick={()=>changeFilter(card.filter)}><span>{card.label}</span><strong>{Number(card.value||0).toLocaleString("ar-SA")}</strong></button>)}</section>
    {error&&<div className="api-error" role="alert">{error}</div>}
    <section className="panel jobs-worklist"><div className="customers-toolbar"><div><h2>قائمة المهام</h2><p>{loading?"جارٍ تحميل المهام...":`${displayTotal.toLocaleString("ar-SA")} مهمة في النطاق المحدد`}</p></div><div className="jobs-toolbar-actions"><select value={filter} onChange={event=>changeFilter(event.target.value as JobFilter)} aria-label="تصفية حالة المهمة"><option value="open">المهام المفتوحة</option><option value="all">جميع الحالات</option><option value="pending_assignment">بانتظار الإسناد</option><option value="scheduled">مجدولة</option><option value="active">قيد التنفيذ</option><option value="overdue">متأخرة</option><option value="completed">مكتملة</option><option value="cancelled">ملغاة</option></select><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="ابحث برقم الطلب أو العميل أو الموقع أو الفني" aria-label="بحث في المهام"/></div></div>
      {shown.length?<><div className="table-wrap"><table><thead><tr><th>الطلب والعميل</th><th>الموقع</th><th>الموعد</th><th>الفني</th><th>الحالة</th><th>الالتزام</th><th>الإجراء</th></tr></thead><tbody>{shown.map(job=><tr key={job.id}><td><a className="customer-name-link" href={`/customers/${encodeURIComponent(job.customer_id)}`}><strong>#{job.external_order_id||job.id} · {job.customer_name}</strong><small dir="ltr">{job.customer_mobile||"—"}</small></a></td><td><strong>{job.address_text||"—"}</strong><small>{job.city_id||"—"}</small></td><td><strong>{dateTime(job.scheduled_at)}</strong><small>{Number(job.service_duration_minutes||60).toLocaleString("ar-SA")} دقيقة</small></td><td><strong>{job.technician_id||"لم يُسند"}</strong><small>{job.required_skill_code||"مهارة عامة"}</small></td><td><span className={`status ${statusClass(job.status)}`}>{statusLabel(job.status)}</span></td><td><span className={`sla-badge ${job.sla_state}`}>{job.sla_state==="unassigned"?"يحتاج إسناد":job.sla_state==="overdue"?`متأخرة ${Number(job.minutes_late||0).toLocaleString("ar-SA")} د`:"ضمن الموعد"}</span></td><td>{["pending_assignment","scheduled"].includes(job.status)?<button className="dispatch-button" onClick={()=>openDispatch(job)}>{job.status==="scheduled"?"إعادة الإسناد":"إسناد وجدولة"}</button>:"—"}</td></tr>)}</tbody></table></div>{apiBase&&total>20&&<nav className="customers-pagination" aria-label="صفحات المهام"><button className="secondary-button" disabled={loading||page===0} onClick={()=>setPage(value=>value-1)}>السابق</button><span>صفحة {(page+1).toLocaleString("ar-SA")} من {Math.ceil(total/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={loading||(page+1)*20>=total} onClick={()=>setPage(value=>value+1)}>التالي</button></nav>}</>:<div className="empty-state">لا توجد مهام مطابقة.</div>}
    </section>
    {dispatchJob&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!dispatchSaving)setDispatchJob(null);}}><section className="customer-modal dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-title"><div className="modal-head"><div><h2 id="dispatch-title">{dispatchJob.status==="scheduled"?"إعادة إسناد المهمة":"إسناد وجدولة المهمة"}</h2><p>#{dispatchJob.external_order_id||dispatchJob.id} · {dispatchJob.customer_name}</p></div><button disabled={dispatchSaving} onClick={()=>setDispatchJob(null)} aria-label="إغلاق">×</button></div><form onSubmit={saveDispatch}><label>الفني المتاح<select name="technicianId" defaultValue="" disabled={candidateLoading||dispatchSaving}><option value="" disabled>{candidateLoading?"جارٍ البحث عن الفنيين...":"اختر الفني"}</option>{candidates.map(candidate=><option key={candidate.technician_id} value={candidate.technician_id}>{candidate.technician_id} · تقييم {Number(candidate.avg_rating||0).toLocaleString("ar-SA")} · {candidate.distance_km?`${candidate.distance_km} كم`:"المسافة غير متاحة"} · {Number(candidate.jobs_in_window||0).toLocaleString("ar-SA")} مهمة</option>)}</select></label><label>موعد التنفيذ<input name="scheduledAt" type="datetime-local" defaultValue={localDateTime(dispatchJob.scheduled_at)} disabled={dispatchSaving}/></label><label>مدة الخدمة بالدقائق<input name="serviceDurationMinutes" type="number" min="1" max="1440" defaultValue={dispatchJob.service_duration_minutes||60} disabled={dispatchSaving}/></label>{dispatchJob.status==="scheduled"&&<label>سبب إعادة الإسناد<input name="reason" placeholder="مثال: طلب العميل تغيير الموعد" disabled={dispatchSaving}/></label>}{dispatchError&&<p className="form-error" role="alert">{dispatchError}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={dispatchSaving} onClick={()=>setDispatchJob(null)}>إلغاء</button><button className="primary-button" disabled={dispatchSaving||candidateLoading||candidates.length===0}>{dispatchSaving?"جارٍ الحفظ...":dispatchJob.status==="scheduled"?"حفظ إعادة الإسناد":"تأكيد الإسناد"}</button></div></form></section></div>}
  </div></main></PreviewAuthGuard>;
}

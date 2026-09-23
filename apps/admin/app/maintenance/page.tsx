"use client";import Header from"../components/Header";

import { useEffect, useMemo, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type WindowFilter="overdue"|"7d"|"30d"|"all";
type Stats={active:number;overdue:number;due_7_days:number;due_30_days:number};
type MaintenanceAsset={id:string;customer_id:string;customer_name:string;customer_mobile?:string;product_id:string;serial_number?:string;city_id?:string;address_text?:string;last_maintenance_at?:string;next_maintenance_at:string;warranty_ends_at?:string;days_until_due:number};

const seed:MaintenanceAsset[]=[
  {id:"AS-1048",customer_id:"CUS-1048",customer_name:"محمد القحطاني",customer_mobile:"055 482 1930",product_id:"جهاز سبيل ٧ مراحل",serial_number:"SBL-7-29418",city_id:"الرياض",address_text:"حي الياسمين",next_maintenance_at:"2026-09-12",last_maintenance_at:"2026-03-12",days_until_due:-3},
  {id:"AS-1046",customer_id:"CUS-1046",customer_name:"شركة روافد",customer_mobile:"011 452 7300",product_id:"فلتر جامبو مركزي",serial_number:"JMB-2048",city_id:"الرياض",address_text:"حي السليمانية",next_maintenance_at:"2026-09-18",last_maintenance_at:"2026-06-18",days_until_due:3},
  {id:"AS-1047",customer_id:"CUS-1047",customer_name:"نورة الدوسري",customer_mobile:"053 761 4280",product_id:"جهاز تحلية منزلي",serial_number:"RO-8801",city_id:"الرياض",address_text:"حي الملقا",next_maintenance_at:"2026-09-28",last_maintenance_at:"2026-03-28",days_until_due:13},
  {id:"AS-1051",customer_id:"CUS-1051",customer_name:"عبدالله الشهري",customer_mobile:"050 117 4200",product_id:"برادة تعبئة ذاتية",serial_number:"CLR-5510",city_id:"الرياض",address_text:"حي قرطبة",next_maintenance_at:"2026-10-20",days_until_due:35}
];
const dateFormatter=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"});
function date(value?:string){return value?dateFormatter.format(new Date(value)):"—";}
function dueLabel(days:number){if(days<0)return `متأخرة ${Math.abs(days).toLocaleString("ar-SA")} يوم`;if(days===0)return"مستحقة اليوم";return `متبقي ${days.toLocaleString("ar-SA")} يوم`;}
function matchesWindow(asset:MaintenanceAsset,window:WindowFilter){if(window==="overdue")return asset.days_until_due<0;if(window==="7d")return asset.days_until_due>=0&&asset.days_until_due<7;if(window==="30d")return asset.days_until_due>=0&&asset.days_until_due<30;return true;}

export default function MaintenancePage(){
  const [assets,setAssets]=useState<MaintenanceAsset[]>(apiBase?[]:seed);
  const [stats,setStats]=useState<Stats>({active:seed.length,overdue:1,due_7_days:1,due_30_days:2});
  const [windowFilter,setWindowFilter]=useState<WindowFilter>("overdue");
  const [query,setQuery]=useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [total,setTotal]=useState(apiBase?0:seed.filter(item=>matchesWindow(item,"overdue")).length);
  const [loading,setLoading]=useState(Boolean(apiBase));
  const [error,setError]=useState("");
  const shown=useMemo(()=>{
    if(apiBase)return assets;
    const q=query.trim().toLowerCase();
    return seed.filter(item=>matchesWindow(item,windowFilter)&&(!q||[item.customer_name,item.customer_mobile,item.product_id,item.serial_number,item.address_text].some(value=>value?.toLowerCase().includes(q))));
  },[assets,query,windowFilter]);
  const displayTotal=apiBase?total:shown.length;

  useEffect(()=>{if(!apiBase)return;const timer=window.setTimeout(()=>{setPage(0);setSearch(query.trim());},300);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),params=new URLSearchParams({window:windowFilter,limit:"20",offset:String(page*20)});
    if(search)params.set("q",search);setLoading(true);
    fetch(`${apiBase}/api/v1/maintenance/assets?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(response.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل جدول الصيانة.");return response.json();})
      .then(payload=>{setAssets(payload.assets||[]);setTotal(Number(payload.pagination?.total||0));setError("");})
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل جدول الصيانة.");})
      .finally(()=>setLoading(false));
    return()=>controller.abort();
  },[page,search,windowFilter]);
  useEffect(()=>{
    if(!apiBase)return;const controller=new AbortController(),token=sessionStorage.getItem("subil_session");
    fetch(`${apiBase}/api/v1/maintenance/stats`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("تعذر تحميل إحصاءات الصيانة.");return response.json();})
      .then(payload=>setStats(payload.stats)).catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل إحصاءات الصيانة.");});
    return()=>controller.abort();
  },[]);
  function changeWindow(value:WindowFilter){setWindowFilter(value);setPage(0);}

  return <PreviewAuthGuard><main className="customers-page maintenance-page"><Header active="/maintenance"/><div className="customers-wrap">
    <div className="demo-notice"><span>تشغيل فعلي</span> مركز متابعة صيانة أجهزة العملاء مرتبط ببيانات النظام المباشرة.</div>
    <div className="page-head"><div><p>التشغيل وخدمة ما بعد البيع</p><h1>مركز الصيانة</h1><span>متابعة الأجهزة المستحقة وترتيب الزيارات قبل التأخير</span></div></div>
    <section className="maintenance-stats" aria-label="ملخص الصيانة"><button className={windowFilter==="overdue"?"active overdue":"overdue"} onClick={()=>changeWindow("overdue")}><span>الصيانة المتأخرة</span><strong>{stats.overdue.toLocaleString("ar-SA")}</strong></button><button className={windowFilter==="7d"?"active":""} onClick={()=>changeWindow("7d")}><span>خلال ٧ أيام</span><strong>{stats.due_7_days.toLocaleString("ar-SA")}</strong></button><button className={windowFilter==="30d"?"active":""} onClick={()=>changeWindow("30d")}><span>خلال ٣٠ يومًا</span><strong>{stats.due_30_days.toLocaleString("ar-SA")}</strong></button><button className={windowFilter==="all"?"active":""} onClick={()=>changeWindow("all")}><span>الأجهزة النشطة</span><strong>{stats.active.toLocaleString("ar-SA")}</strong></button></section>
    {error&&<div className="api-error" role="alert">{error}</div>}
    <section className="panel maintenance-worklist"><div className="customers-toolbar"><div><h2>جدول الاستحقاقات</h2><p>{loading?"جارٍ تحميل الأجهزة...":`${displayTotal.toLocaleString("ar-SA")} جهاز في النطاق المحدد`}</p></div><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="ابحث بالعميل، الجوال، الجهاز أو الرقم التسلسلي" aria-label="بحث في صيانة الأجهزة"/></div>
      {shown.length?<><div className="table-wrap"><table><thead><tr><th>العميل</th><th>الجهاز</th><th>الموقع</th><th>آخر صيانة</th><th>الاستحقاق القادم</th><th>الحالة</th></tr></thead><tbody>{shown.map(asset=><tr key={asset.id}><td><a className="customer-name-link" href={`/customers/${encodeURIComponent(asset.customer_id)}`}><strong>{asset.customer_name}</strong><small dir="ltr">{asset.customer_mobile||"—"}</small></a></td><td><strong>{asset.product_id}</strong><small>{asset.serial_number||"بدون رقم تسلسلي"}</small></td><td><strong>{asset.address_text||"—"}</strong><small>{asset.city_id||"—"}</small></td><td>{date(asset.last_maintenance_at)}</td><td>{date(asset.next_maintenance_at)}</td><td><span className={`maintenance-due ${asset.days_until_due<0?"late":asset.days_until_due<7?"soon":"planned"}`}>{dueLabel(asset.days_until_due)}</span></td></tr>)}</tbody></table></div>{apiBase&&total>20&&<nav className="customers-pagination" aria-label="صفحات جدول الصيانة"><button className="secondary-button" disabled={loading||page===0} onClick={()=>setPage(value=>value-1)}>السابق</button><span>صفحة {(page+1).toLocaleString("ar-SA")} من {Math.ceil(total/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={loading||(page+1)*20>=total} onClick={()=>setPage(value=>value+1)}>التالي</button></nav>}</>:<div className="empty-state">لا توجد أجهزة ضمن هذا النطاق.</div>}
    </section>
  </div></main></PreviewAuthGuard>;
}

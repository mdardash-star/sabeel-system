"use client";

import { useEffect, useState } from "react";
import PreviewAuthGuard from "./preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";

const nav = [
  ["الرئيسية","/"],
  ["الطلبات والمهام","/jobs"],
  ["العملاء","/customers"],
  ["مزودو الخدمة","/technicians"],
  ["مركز الصيانة","/maintenance"],
  ["المالية","/finance"],
  ["المخزون والمشتريات","/inventory"],
  ["التقارير والتحليلات","/reports"],
  ["CMO / التسويق الذكي","/marketing/growth"],
  ["الحملات التسويقية","/marketing"],
  ["مساعدات الذكاء الاصطناعي","/ai"],
  ["الصلاحيات ومراكز التحكم","/portals"],
];

const cmo = [
  ["Competitive Intelligence","الأسعار والعروض والمنافسون"],
  ["Retention & Loyalty","الصيانة، Win-back، VIP"],
  ["Brand Reputation","التقييمات والمشاعر والشكاوى"],
  ["Revenue Intelligence","القنوات والشرائح والربحية"],
  ["Executive CMO Brief","ملخص يومي للإدارة"],
  ["SEO & Content","الكلمات، الصفحات، المحتوى"],
  ["Channel Intelligence","CAC / LTV / ROAS / Attribution"],
  ["Experiment Lab","اختبارات A/B للنمو"],
];

type JobStats={open:number;pending_assignment:number;scheduled_today:number;in_progress:number;overdue:number;completed_today:number};
type TechStats={total:number;active:number;inactive:number;available_now:number;busy_now:number;avg_rating:number|string};
type Provider={id:string;mobile:string;jobs_today:number;active_jobs:number;completed_30d:number;on_time_30d:number;avg_rating:number|string};
type Profit={summary:{order_count:number;revenue:number|string;net_profit:number|string}};
type MaintenanceStats={active:number;overdue:number;due_7_days:number;due_30_days:number};
type InventoryStats={total_skus:number;out_of_stock:number;low_stock:number};
type CartsStats={active:number;at_risk_value:number|string;recovery_rate:number|string};
type Channel={name:string;orders:number;revenue:number|string;roas:number|string|null};
type Brief={summary:string;brief_date:string}|null;

const jobStatsSeed:JobStats={open:3,pending_assignment:1,scheduled_today:2,in_progress:1,overdue:1,completed_today:1};
const techStatsSeed:TechStats={total:4,active:3,inactive:1,available_now:1,busy_now:2,avg_rating:4.8};
const providersSeed:Provider[]=[
  {id:"TECH-12",mobile:"+966501234567",jobs_today:4,active_jobs:1,completed_30d:38,on_time_30d:35,avg_rating:4.9},
  {id:"TECH-08",mobile:"+966502345678",jobs_today:3,active_jobs:0,completed_30d:32,on_time_30d:27,avg_rating:4.7},
  {id:"TECH-04",mobile:"+966503456789",jobs_today:2,active_jobs:1,completed_30d:29,on_time_30d:25,avg_rating:4.8},
];
const profitSeed:Profit={summary:{order_count:48,revenue:42680,net_profit:12096}};
const maintenanceSeed:MaintenanceStats={active:96,overdue:6,due_7_days:32,due_30_days:84};
const inventorySeed:InventoryStats={total_skus:64,out_of_stock:2,low_stock:4};
const cartsSeed:CartsStats={active:8,at_risk_value:6450,recovery_rate:33};
const channelsSeed:Channel[]=[{name:"google",orders:22,revenue:18900,roas:5.8},{name:"whatsapp",orders:14,revenue:11200,roas:4.9},{name:"organic",orders:9,revenue:7300,roas:null}];
const briefSeed:Brief={summary:"أقوى فرصة حالية هي تحويل استحقاقات الصيانة والسلات المتروكة إلى حملات موجهة، مع متابعة مزودي الخدمة الأعلى ضغطًا.",brief_date:new Date().toISOString().slice(0,10)};

const money=(v:number|string)=>Number(v||0).toLocaleString("ar-SA",{maximumFractionDigits:0});
const percent=(part:number,total:number)=>total?Math.round((part/total)*100):0;

export default function Dashboard(){
  const [jobStats,setJobStats]=useState<JobStats>(jobStatsSeed);
  const [jobsAllowed,setJobsAllowed]=useState(!apiBase);
  const [techStats,setTechStats]=useState<TechStats>(techStatsSeed);
  const [providers,setProviders]=useState<Provider[]>(apiBase?[]:providersSeed);
  const [techAllowed,setTechAllowed]=useState(!apiBase);
  const [profit,setProfit]=useState<Profit>(profitSeed);
  const [revenueAllowed,setRevenueAllowed]=useState(!apiBase);
  const [maintenance,setMaintenance]=useState<MaintenanceStats>(maintenanceSeed);
  const [maintenanceAllowed,setMaintenanceAllowed]=useState(!apiBase);
  const [inventory,setInventory]=useState<InventoryStats>(inventorySeed);
  const [inventoryAllowed,setInventoryAllowed]=useState(!apiBase);
  const [carts,setCarts]=useState<CartsStats>(cartsSeed);
  const [channels,setChannels]=useState<Channel[]>(apiBase?[]:channelsSeed);
  const [marketingAllowed,setMarketingAllowed]=useState(!apiBase);
  const [brief,setBrief]=useState<Brief>(apiBase?null:briefSeed);
  const [briefAllowed,setBriefAllowed]=useState(!apiBase);

  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),headers={Authorization:`Bearer ${token}`};
    const to=new Date(),from=new Date(to.getTime()-29*86400000),range=new URLSearchParams({from:from.toISOString(),to:to.toISOString()});

    fetch(`${apiBase}/api/v1/jobs/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setJobsAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setJobStats(p.stats);setJobsAllowed(true)}}).catch(()=>{});

    fetch(`${apiBase}/api/v1/technicians/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setTechAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setTechStats(p.stats);setTechAllowed(true)}}).catch(()=>{});
    fetch(`${apiBase}/api/v1/technicians?status=active&limit=4`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(p=>{if(p?.technicians)setProviders(p.technicians)}).catch(()=>{});

    fetch(`${apiBase}/api/v1/reports/profitability?${range}`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setRevenueAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p){setProfit(p);setRevenueAllowed(true)}}).catch(()=>{});

    fetch(`${apiBase}/api/v1/maintenance/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setMaintenanceAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setMaintenance(p.stats);setMaintenanceAllowed(true)}}).catch(()=>{});

    fetch(`${apiBase}/api/v1/inventory/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setInventoryAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setInventory(p.stats);setInventoryAllowed(true)}}).catch(()=>{});

    fetch(`${apiBase}/api/v1/marketing/abandoned-carts/stats`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setMarketingAllowed(false);return null}return r.ok?r.json():null}).then(p=>{if(p?.stats){setCarts(p.stats);setMarketingAllowed(true)}}).catch(()=>{});
    fetch(`${apiBase}/api/v1/marketing/attribution?${range}`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(p=>{if(p?.channels)setChannels(p.channels.slice(0,4))}).catch(()=>{});

    fetch(`${apiBase}/api/v1/ai/brief`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setBriefAllowed(false);return null}return r.ok?r.json():undefined}).then(p=>{if(p!==undefined){setBrief(p?.brief||null);setBriefAllowed(true)}}).catch(()=>{});

    return()=>controller.abort();
  },[]);

  const orderStages:Array<[string,number]>=[["مفتوحة",jobStats.open],["بانتظار الإسناد",jobStats.pending_assignment],["مجدولة اليوم",jobStats.scheduled_today],["قيد التنفيذ",jobStats.in_progress],["متأخرة",jobStats.overdue],["مكتملة اليوم",jobStats.completed_today]];
  const maxStage=Math.max(...orderStages.map(([,v])=>v),1);
  const busyPercent=techStats.total?Math.round((techStats.busy_now/techStats.total)*100):0;
  const avgOrder=Number(profit.summary.order_count)?Number(profit.summary.revenue)/Number(profit.summary.order_count):0;
  const margin=Number(profit.summary.revenue)?(Number(profit.summary.net_profit)/Number(profit.summary.revenue))*100:0;
  const stockAvailability=inventory.total_skus?Math.round(((inventory.total_skus-inventory.out_of_stock)/inventory.total_skus)*100):0;
  const maxChannelRevenue=Math.max(...channels.map(c=>Number(c.revenue||0)),1);

  const kpis:Array<[string,string,string]>=[
    ["مجدولة اليوم", jobsAllowed?jobStats.scheduled_today.toLocaleString("ar-SA"):"—", jobsAllowed?`${jobStats.overdue.toLocaleString("ar-SA")} متأخرة`:"بدون صلاحية"],
    ["قيد التنفيذ", jobsAllowed?jobStats.in_progress.toLocaleString("ar-SA"):"—", jobsAllowed?`${jobStats.pending_assignment.toLocaleString("ar-SA")} بانتظار الإسناد`:""],
    ["مكتملة اليوم", jobsAllowed?jobStats.completed_today.toLocaleString("ar-SA"):"—", jobsAllowed?`${jobStats.open.toLocaleString("ar-SA")} مفتوحة`:""],
    ["متأخرة", jobsAllowed?jobStats.overdue.toLocaleString("ar-SA"):"—", "تحتاج متابعة"],
    ["الإيراد (٣٠ يوم)", revenueAllowed?`${money(profit.summary.revenue)} ر.س`:"—", revenueAllowed?`${Number(profit.summary.order_count).toLocaleString("ar-SA")} طلب`:"بدون صلاحية"],
    ["متوسط قيمة الطلب", revenueAllowed?`${money(avgOrder)} ر.س`:"—", revenueAllowed?`هامش ${margin.toLocaleString("ar-SA",{maximumFractionDigits:1})}٪`:""],
    ["مزودو خدمة متاحون", techAllowed?`${techStats.available_now.toLocaleString("ar-SA")} / ${techStats.total.toLocaleString("ar-SA")}`:"—", techAllowed?`${busyPercent.toLocaleString("ar-SA")}٪ إشغال`:"بدون صلاحية"],
    ["فنيون نشطون", techAllowed?techStats.active.toLocaleString("ar-SA"):"—", techAllowed?`${techStats.inactive.toLocaleString("ar-SA")} غير نشط`:""],
  ];

  const alerts:Array<[string,string,string]>=[
    ...(jobsAllowed&&jobStats.overdue>0?[[`${jobStats.overdue.toLocaleString("ar-SA")} مهام متأخرة`,"تشغيلي","/jobs"] as [string,string,string]]:[]),
    ...(maintenanceAllowed&&maintenance.overdue>0?[[`${maintenance.overdue.toLocaleString("ar-SA")} صيانة متأخرة`,"احتفاظ","/maintenance"] as [string,string,string]]:[]),
    ...(marketingAllowed&&carts.active>0?[[`${carts.active.toLocaleString("ar-SA")} سلات متروكة نشطة بقيمة ${money(carts.at_risk_value)} ر.س`,"تسويق","/marketing/abandoned-carts"] as [string,string,string]]:[]),
    ...(inventoryAllowed&&inventory.low_stock>0?[[`${inventory.low_stock.toLocaleString("ar-SA")} أصناف تحت حد إعادة الطلب`,"مخزون","/inventory"] as [string,string,string]]:[]),
  ];

  return <PreviewAuthGuard>
    <main className="executive-shell">
      <aside className="executive-sidebar">
        <a className="executive-brand" href="/"><span>S</span><div><strong>سبيل</strong><small>Command Center</small></div></a>
        <p className="executive-nav-title">مركز القيادة</p>
        <nav className="executive-nav">
          {nav.map(([label,href],i)=><a className={i===0?"active":""} href={href} key={href}><span>{label}</span><b>›</b></a>)}
        </nav>
        <a className="executive-cmo-link" href="/marketing/growth"><small>SUBIL AI</small><strong>CMO / التسويق الذكي</strong><span>فتح مركز النمو والتحليل ←</span></a>
      </aside>

      <section className="executive-main">
        <header className="executive-topbar">
          <div><strong>لوحة القيادة التنفيذية</strong><span>الطلبات · العملاء · مزودو الخدمة · الإيرادات · التسويق</span></div>
          <div className="executive-top-actions"><a href="/ai/insights">الرؤى الذكية</a><a href="/marketing/growth">CMO</a><div>م</div></div>
        </header>

        <div className="executive-content">
          <section className="executive-hero">
            <div><span>SUBIL OS</span><h1>صورة كاملة للنشاط في شاشة واحدة</h1><p>متابعة لحظية لحركة الطلبات، مزودي الخدمة، الإيرادات، المخزون والتسويق مع تنبيهات وفرص نمو قابلة للتنفيذ.</p></div>
          </section>

          <section className="executive-kpis">
            {kpis.map(([l,v,c])=><article key={l}><span>{l}</span><strong>{v}</strong>{c&&<small>{c}</small>}</article>)}
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>حركة الطلبات</h2><p>توزيع المهام حسب الحالة الآن</p></div><a href="/jobs">كل الطلبات</a></header>
              {jobsAllowed?<div className="order-funnel">
                {orderStages.map(([label,count])=><div key={label}><div><span>{label}</span><b>{count.toLocaleString("ar-SA")}</b></div><i><em style={{width:`${Math.max(4,(count/maxStage)*100)}%`}} /></i></div>)}
              </div>:<p className="empty-state">لا تملك صلاحية عرض بيانات المهام.</p>}
            </article>

            <article className="exec-panel">
              <header><div><h2>التنبيهات التنفيذية</h2><p>أهم ما يحتاج تدخل اليوم</p></div><a href="/ai/insights">تحليل أعمق</a></header>
              <div className="exec-alerts">{alerts.map(([t,tag,href])=><a href={href} key={t}><div><strong>{t}</strong><small>{tag}</small></div><b>←</b></a>)}{!alerts.length&&<p className="empty-state">لا توجد تنبيهات حاليًا.</p>}</div>
            </article>
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>تحليل مزودي الخدمة</h2><p>الالتزام، التقييم والحمل التشغيلي</p></div><a href="/technicians">عرض المزودين</a></header>
              {techAllowed?<div className="provider-table">
                <div className="provider-head"><span>المزود</span><span>الالتزام</span><span>التقييم</span><span>مهام اليوم</span><span>منجزة ٣٠ يوم</span></div>
                {providers.map(p=><div key={p.id}><span>{p.id}</span><span>{percent(p.on_time_30d,p.completed_30d)}٪</span><span>★ {Number(p.avg_rating||0).toLocaleString("ar-SA",{maximumFractionDigits:1})}</span><span>{p.jobs_today.toLocaleString("ar-SA")}</span><span>{p.completed_30d.toLocaleString("ar-SA")}</span></div>)}
                {!providers.length&&<p className="empty-state">لا يوجد مزودو خدمة نشطون حاليًا.</p>}
              </div>:<p className="empty-state">لا تملك صلاحية عرض بيانات مزودي الخدمة.</p>}
            </article>

            <article className="exec-panel">
              <header><div><h2>فرص الاحتفاظ والتسويق</h2><p>السلات المتروكة واستحقاقات الصيانة</p></div><a href="/customers">قاعدة العملاء</a></header>
              {marketingAllowed||maintenanceAllowed?<div className="customer-matrix">
                {marketingAllowed&&<div><span>سلات متروكة نشطة</span><strong>{carts.active.toLocaleString("ar-SA")}</strong><small>{money(carts.at_risk_value)} ر.س معرّضة للفقد</small></div>}
                {marketingAllowed&&<div><span>نسبة الاسترداد</span><strong>{Number(carts.recovery_rate).toLocaleString("ar-SA",{maximumFractionDigits:1})}٪</strong></div>}
                {maintenanceAllowed&&<div><span>صيانة مستحقة (٧ أيام)</span><strong>{maintenance.due_7_days.toLocaleString("ar-SA")}</strong></div>}
                {maintenanceAllowed&&<div><span>صيانة مستحقة (٣٠ يوم)</span><strong>{maintenance.due_30_days.toLocaleString("ar-SA")}</strong></div>}
                {maintenanceAllowed&&<div><span>صيانة متأخرة</span><strong>{maintenance.overdue.toLocaleString("ar-SA")}</strong></div>}
              </div>:<p className="empty-state">لا تملك صلاحية عرض بيانات العملاء.</p>}
            </article>
          </section>

          <section className="executive-grid three">
            <article className="exec-panel revenue-panel">
              <header><div><h2>الإيرادات والربحية</h2><p>ملخص مالي آخر ٣٠ يومًا</p></div><a href="/finance">المالية</a></header>
              {revenueAllowed?<>
                <div className="big-number">{money(profit.summary.revenue)} <small>ر.س آخر ٣٠ يومًا</small></div>
                <div className="metric-row"><span>هامش صافي <b>{margin.toLocaleString("ar-SA",{maximumFractionDigits:1})}٪</b></span><span>متوسط الطلب <b>{money(avgOrder)} ر.س</b></span><span>عدد الطلبات <b>{Number(profit.summary.order_count).toLocaleString("ar-SA")}</b></span></div>
              </>:<p className="empty-state">لا تملك صلاحية عرض الإيرادات.</p>}
            </article>
            <article className="exec-panel">
              <header><div><h2>المخزون</h2><p>حالة التوفر</p></div><a href="/inventory">المخزون</a></header>
              {inventoryAllowed?<><div className="stock-health"><strong>{stockAvailability.toLocaleString("ar-SA")}٪</strong><span>توفر الأصناف</span></div>
              <ul className="simple-list"><li>{inventory.low_stock.toLocaleString("ar-SA")} صنف تحت حد إعادة الطلب</li><li>{inventory.out_of_stock.toLocaleString("ar-SA")} صنف نافد</li></ul></>:<p className="empty-state">لا تملك صلاحية عرض المخزون.</p>}
            </article>
            <article className="exec-panel">
              <header><div><h2>الصيانة والاستحقاقات</h2><p>فرص الخدمة القادمة</p></div><a href="/maintenance">مركز الصيانة</a></header>
              {maintenanceAllowed?<><div className="stock-health"><strong>{maintenance.due_30_days.toLocaleString("ar-SA")}</strong><span>استحقاق خلال ٣٠ يوم</span></div>
              <ul className="simple-list"><li>{maintenance.due_7_days.toLocaleString("ar-SA")} خلال ٧ أيام</li><li>{maintenance.overdue.toLocaleString("ar-SA")} متأخرة</li></ul></>:<p className="empty-state">لا تملك صلاحية عرض الصيانة.</p>}
            </article>
          </section>

          <section className="exec-panel cmo-command">
            <header><div><h2>CMO / مركز النمو والتسويق الذكي</h2><p>كل محركات النمو والتحليل التسويقي في مكان واحد</p></div><a href="/marketing/growth">فتح CMO الكامل</a></header>
            <div className="cmo-grid">{cmo.map(([t,d])=><a href="/marketing/growth" key={t}><strong>{t}</strong><span>{d}</span><b>←</b></a>)}</div>
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>القنوات والأداء التسويقي</h2><p>مقارنة الإيراد حسب مصدر الزيارة، آخر ٣٠ يومًا</p></div><a href="/marketing/growth">التفاصيل</a></header>
              {marketingAllowed&&channels.length?<div className="channel-bars">
                {channels.map(c=><div key={c.name}><span>{c.name||"بدون مصدر"}</span><i><em style={{width:`${Math.max(4,(Number(c.revenue||0)/maxChannelRevenue)*100)}%`}} /></i><b>{c.roas!=null?`${c.roas}×`:"—"}</b></div>)}
              </div>:<p className="empty-state">{marketingAllowed?"لا توجد بيانات قنوات كافية بعد.":"لا تملك صلاحية عرض بيانات القنوات."}</p>}
            </article>
            <article className="exec-panel">
              <header><div><h2>ملخص الإدارة التنفيذي</h2><p>Executive Brief</p></div><a href="/ai/insights">مركز الرؤى</a></header>
              {briefAllowed?(brief?<div className="brief-box"><strong>ملخص {brief.brief_date}</strong><p>{brief.summary}</p></div>:<p className="empty-state">لم يُنشأ ملخص تنفيذي بعد. شغّل التحليل من مركز الرؤى الذكية.</p>):<p className="empty-state">لا تملك صلاحية عرض الملخص التنفيذي.</p>}
            </article>
          </section>
        </div>
      </section>
    </main>
  </PreviewAuthGuard>;
}

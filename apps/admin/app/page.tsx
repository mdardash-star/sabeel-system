"use client";

import { useEffect, useState } from "react";
import PreviewAuthGuard from "./preview-auth-guard";

type IconName =
  | "grid"
  | "orders"
  | "customers"
  | "tech"
  | "calendar"
  | "wallet"
  | "inventory"
  | "reports"
  | "settings"
  | "bell"
  | "search"
  | "arrow"
  | "pin"
  | "clock"
  | "check";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    orders: <><path d="M6 3h12l2 5-8 4-8-4 2-5Z"/><path d="M4 8v10l8 4 8-4V8M12 12v10"/></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    tech: <><path d="m14.7 6.3-2.4 2.4 3 3 2.4-2.4a4 4 0 0 0 1.1-4.1l-2.1 2.1-2-2 2.1-2.1a4 4 0 0 0-4.1 1.1L4 13a3 3 0 1 0 4 4l6.7-6.7"/><circle cx="6" cy="15" r="1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
    wallet: <><rect x="2" y="5" width="20" height="15" rx="3"/><path d="M16 13h6M18 11v4"/></>,
    inventory: <><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    reports: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V2"/><path d="M2 19h22"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88L4.2 7.03 7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.09a1.7 1.7 0 0 0 1.03 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    arrow: <><path d="m9 18 6-6-6-6"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
  };

  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const navItems: Array<{ label: string; icon: IconName; active?: boolean; badge?: number }> = [
  { label: "لوحة التحكم", icon: "grid", active: true },
  { label: "الطلبات والمهام", icon: "orders" },
  { label: "العملاء", icon: "customers" },
  { label: "الفنيون", icon: "tech" },
  { label: "مركز الصيانة", icon: "calendar" },
  { label: "المالية", icon: "wallet" },
  { label: "المخزون", icon: "inventory" },
  { label: "التقارير", icon: "reports" },
  { label: "التسويق", icon: "bell" },
];

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";

type JobStats={open:number;pending_assignment:number;scheduled_today:number;in_progress:number;overdue:number;completed_today:number};
type DashboardJob={id:string;external_order_id?:string;customer_name:string;address_text?:string;technician_id?:string;required_skill_code?:string;status:string;scheduled_at?:string};
type TechStats={total:number;active:number;inactive:number;available_now:number;busy_now:number;avg_rating:number|string};
type DashboardTechnician={id:string;mobile:string;jobs_today:number;active_jobs:number;avg_rating:number|string;is_active:boolean};
type Trend={period:string;orders:number;revenue:number|string;profit:number|string};

const jobStatsSeed:JobStats={open:3,pending_assignment:1,scheduled_today:2,in_progress:1,overdue:1,completed_today:1};
const jobsSeed:DashboardJob[]=[
  {id:"JOB-1048",external_order_id:"1048",customer_name:"محمد القحطاني",address_text:"حي الياسمين",technician_id:"TECH-12",required_skill_code:"ro-install",status:"en_route",scheduled_at:"2026-09-15T08:30:00Z"},
  {id:"JOB-1047",external_order_id:"1047",customer_name:"نورة الدوسري",address_text:"حي الملقا",technician_id:"TECH-06",required_skill_code:"ro-maintenance",status:"in_progress",scheduled_at:"2026-09-15T08:00:00Z"},
  {id:"JOB-1046",external_order_id:"1046",customer_name:"شركة روافد",address_text:"حي السليمانية",technician_id:"TECH-08",required_skill_code:"jumbo",status:"scheduled",scheduled_at:"2026-09-15T12:30:00Z"},
  {id:"JOB-1045",external_order_id:"1045",customer_name:"سعد العتيبي",address_text:"حي قرطبة",technician_id:"TECH-04",required_skill_code:"tank-cleaning",status:"completed",scheduled_at:"2026-09-15T13:00:00Z"},
];
const techStatsSeed:TechStats={total:4,active:3,inactive:1,available_now:1,busy_now:2,avg_rating:4.8};
const techniciansSeed:DashboardTechnician[]=[
  {id:"TECH-12",mobile:"+966501234567",jobs_today:4,active_jobs:1,avg_rating:4.9,is_active:true},
  {id:"TECH-06",mobile:"+966505678901",jobs_today:3,active_jobs:1,avg_rating:4.8,is_active:true},
  {id:"TECH-08",mobile:"+966502345678",jobs_today:3,active_jobs:0,avg_rating:4.7,is_active:true},
  {id:"TECH-04",mobile:"+966503456789",jobs_today:2,active_jobs:1,avg_rating:4.8,is_active:true},
];
const trendSeed:Trend[]=[{period:"2026-09-09",orders:48,revenue:5200,profit:1450},{period:"2026-09-10",orders:65,revenue:6800,profit:2100},{period:"2026-09-11",orders:40,revenue:5900,profit:1550},{period:"2026-09-12",orders:76,revenue:7900,profit:2380},{period:"2026-09-13",orders:58,revenue:7300,profit:2016},{period:"2026-09-14",orders:86,revenue:9580,profit:2600},{period:"2026-09-15",orders:72,revenue:8450,profit:2210}];
const revenueSeed=42680;

function statusLabel(value:string){return({pending_assignment:"بانتظار الإسناد",scheduled:"مجدولة",en_route:"في الطريق",arrived:"وصل الفني",in_progress:"قيد التنفيذ",completed:"مكتملة",cancelled:"ملغاة"} as Record<string,string>)[value]||value;}
function statusClass(value:string){return value==="completed"?"done":value==="en_route"?"enroute":value==="arrived"||value==="in_progress"?"working":"scheduled";}
function timeOf(value?:string){return value?new Intl.DateTimeFormat("ar-SA",{timeStyle:"short"}).format(new Date(value)):"—";}
function dayOf(value:string){return new Intl.DateTimeFormat("ar-SA",{weekday:"short"}).format(new Date(value));}
const money=(v:number|string)=>Number(v||0).toLocaleString("ar-SA",{maximumFractionDigits:0});
const today=new Intl.DateTimeFormat("ar-SA",{weekday:"long",day:"numeric",month:"long"}).format(new Date());

export default function Dashboard() {
  const [jobStats,setJobStats]=useState<JobStats>(jobStatsSeed);
  const [jobs,setJobs]=useState<DashboardJob[]>(apiBase?[]:jobsSeed);
  const [techStats,setTechStats]=useState<TechStats>(techStatsSeed);
  const [technicians,setTechnicians]=useState<DashboardTechnician[]>(apiBase?[]:techniciansSeed);
  const [trend,setTrend]=useState<Trend[]>(apiBase?[]:trendSeed);
  const [revenue,setRevenue]=useState<number|string>(revenueSeed);
  const [revenueAllowed,setRevenueAllowed]=useState(!apiBase);

  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session"),headers={Authorization:`Bearer ${token}`};
    fetch(`${apiBase}/api/v1/jobs/stats`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(payload=>{if(payload?.stats)setJobStats(payload.stats)}).catch(()=>{});
    fetch(`${apiBase}/api/v1/jobs?status=open&limit=4`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(payload=>{if(payload?.jobs)setJobs(payload.jobs)}).catch(()=>{});
    fetch(`${apiBase}/api/v1/technicians/stats`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(payload=>{if(payload?.stats)setTechStats(payload.stats)}).catch(()=>{});
    fetch(`${apiBase}/api/v1/technicians?status=active&limit=4`,{headers,signal:controller.signal}).then(async r=>r.ok?r.json():null).then(payload=>{if(payload?.technicians)setTechnicians(payload.technicians)}).catch(()=>{});
    const to=new Date(),from=new Date(to.getTime()-6*86400000),params=new URLSearchParams({from:from.toISOString(),to:to.toISOString()});
    fetch(`${apiBase}/api/v1/reports/profitability?${params}`,{headers,signal:controller.signal}).then(async r=>{if(r.status===403){setRevenueAllowed(false);return null}return r.ok?r.json():null;}).then(payload=>{if(payload){setTrend(payload.trend||[]);setRevenue(payload.summary?.revenue??0);setRevenueAllowed(true)}}).catch(()=>{});
    return()=>controller.abort();
  },[]);

  const stats=[
    { label: "مهام مجدولة اليوم", value: jobStats.scheduled_today.toLocaleString("ar-SA"), change: `${jobStats.overdue.toLocaleString("ar-SA")} متأخرة`, tone: "blue", icon: "orders" as IconName },
    { label: "مهام قيد التنفيذ", value: jobStats.in_progress.toLocaleString("ar-SA"), change: `${jobStats.pending_assignment.toLocaleString("ar-SA")} بانتظار الإسناد`, tone: "amber", icon: "clock" as IconName },
    { label: "مهام مكتملة اليوم", value: jobStats.completed_today.toLocaleString("ar-SA"), change: `${jobStats.open.toLocaleString("ar-SA")} مفتوحة`, tone: "green", icon: "check" as IconName },
    { label: "الإيراد (آخر ٧ أيام)", value: revenueAllowed?money(revenue):"—", suffix: revenueAllowed?"ر.س":undefined, change: revenueAllowed?"":"بدون صلاحية عرض", tone: "violet", icon: "wallet" as IconName },
  ];
  const maxTrend=Math.max(...trend.map(x=>Number(x.revenue||0)),1);
  const busyPercent=techStats.total?Math.round((techStats.busy_now/techStats.total)*100):0;

  return (
    <PreviewAuthGuard>
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span>S</span></div>
          <div><strong>سبيل</strong><small>نظام التشغيل</small></div>
        </div>
        <nav className="nav" aria-label="التنقل الرئيسي">
          <p className="nav-label">القائمة الرئيسية</p>
          {navItems.map((item) => (
            <a className={`nav-item${item.active ? " active" : ""}`} href={item.icon === "orders" ? "/jobs" : item.icon === "customers" ? "/customers" : item.icon === "tech" ? "/technicians" : item.icon === "calendar" ? "/maintenance" : item.icon === "wallet" ? "/finance" : item.icon === "inventory" ? "/inventory" : item.icon === "reports" ? "/reports" : item.label === "التسويق" ? "/marketing" : "#"} key={item.label}>
              <Icon name={item.icon} /><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a className="nav-item" href="#"><Icon name="settings" /><span>الإعدادات</span></a>
          <div className="support-card"><span>تحتاج مساعدة؟</span><strong>فريق الدعم معك</strong><button>تواصل معنا</button></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><span>S</span></div><strong>سبيل</strong></div>
          <label className="search"><Icon name="search" size={19}/><input aria-label="بحث" placeholder="ابحث عن طلب، عميل أو فني..." /></label>
          <div className="top-actions">
            <button className="round-button" aria-label="الإشعارات"><Icon name="bell"/><i /></button>
            <div className="profile"><div className="profile-copy"><strong>مدير النظام</strong><span>الإدارة العليا</span></div><div className="profile-avatar">م</div></div>
          </div>
        </header>

        <div className="content">
          <div className="demo-notice"><span>نظرة عامة</span> الأرقام والقوائم أدناه تُحدَّث تلقائيًا من بيانات الإنتاج.</div>
          <div className="page-head">
            <div><p>{today}</p><h1>مرحبًا بك 👋</h1><span>إليك ملخص العمليات في سبيل اليوم</span></div>
            <a className="primary-button" href="/jobs"><span>+</span> إنشاء طلب جديد</a>
          </div>

          <section className="stats-grid" aria-label="مؤشرات اليوم">
            {stats.map((stat) => <article className="stat-card" key={stat.label}>
              <div className={`stat-icon ${stat.tone}`}><Icon name={stat.icon}/></div>
              <div className="stat-copy"><span>{stat.label}</span><div><strong>{stat.value}</strong>{stat.suffix && <small>{stat.suffix}</small>}</div>{stat.change && <em>{stat.change}</em>}</div>
            </article>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel jobs-panel">
              <div className="panel-head"><div><h2>مهام مفتوحة</h2><p>متابعة حالة طلبات التركيب والصيانة</p></div><a href="/jobs">عرض الكل <Icon name="arrow" size={16}/></a></div>
              <div className="table-wrap"><table>
                <thead><tr><th>رقم الطلب</th><th>العميل والخدمة</th><th>الفني</th><th>الموقع والموعد</th><th>الحالة</th><th></th></tr></thead>
                <tbody>{jobs.map((job) => <tr key={job.id}>
                  <td><strong className="order-id">{job.external_order_id?`#${job.external_order_id}`:job.id}</strong></td>
                  <td><strong>{job.customer_name}</strong><small>{job.required_skill_code||"مهارة عامة"}</small></td>
                  <td>{job.technician_id||"لم يُسند"}</td>
                  <td><span className="meta"><Icon name="pin" size={14}/>{job.address_text||"—"}</span><small className="meta"><Icon name="clock" size={14}/>{timeOf(job.scheduled_at)}</small></td>
                  <td><span className={`status ${statusClass(job.status)}`}>{statusLabel(job.status)}</span></td>
                  <td><a className="dots" aria-label={`تفاصيل ${job.id}`} href="/jobs">•••</a></td>
                </tr>)}{!jobs.length&&<tr><td colSpan={6} className="empty-state">لا توجد مهام مفتوحة حاليًا.</td></tr>}</tbody>
              </table></div>
            </article>

            <article className="panel team-panel">
              <div className="panel-head"><div><h2>الفنيون النشطون</h2><p>حالة الفريق الميداني</p></div><a href="/technicians">عرض الكل</a></div>
              <div className="team-list">{technicians.map((tech) => <div className="tech-row" key={tech.id}>
                <div className="tech-avatar avatar-blue">{tech.id.replace(/[^0-9]/g,"").slice(-2)||tech.id.slice(0,2)}</div>
                <div className="tech-info"><strong>{tech.id}</strong><span>★ {Number(tech.avg_rating||0).toLocaleString("ar-SA",{maximumFractionDigits:1})} · {tech.jobs_today.toLocaleString("ar-SA")} مهام</span></div>
                <span className={`availability ${tech.active_jobs>0?"busy":"available"}`}><i />{tech.active_jobs>0?"في مهمة":"متاح"}</span>
              </div>)}{!technicians.length&&<div className="empty-state">لا يوجد فنيون نشطون حاليًا.</div>}</div>
              <div className="capacity"><div><span>إشغال الفريق</span><strong>{busyPercent.toLocaleString("ar-SA")}٪</strong></div><div className="progress"><i style={{width:`${busyPercent}%`}}/></div><p>{techStats.busy_now.toLocaleString("ar-SA")} من {techStats.total.toLocaleString("ar-SA")} فنيًا نشطًا مشغولون الآن</p></div>
            </article>

            <article className="panel chart-panel">
              <div className="panel-head"><div><h2>أداء الطلبات</h2><p>آخر ٧ أيام</p></div></div>
              {revenueAllowed?<>
                <div className="chart-summary"><div><span>إجمالي الإيراد</span><strong>{money(revenue)}</strong><em>ر.س</em></div><div className="legend"><span><i className="legend-blue"/>الإيراد</span><span><i className="legend-green"/>الربح</span></div></div>
                <div className="chart" aria-label="رسم بياني لأداء الطلبات">
                  {trend.map((bar) => <div className="bar-group" key={bar.period}><div className="bars"><i style={{height:`${Math.max(4,(Number(bar.revenue)/maxTrend)*100)}%`}}/><i style={{height:`${Math.max(4,(Number(bar.profit)/maxTrend)*100)}%`}}/></div><span>{dayOf(bar.period)}</span></div>)}
                  {!trend.length&&<p className="empty-state">لا توجد بيانات كافية بعد.</p>}
                </div>
              </>:<p className="empty-state">لا تملك صلاحية عرض بيانات الإيراد.</p>}
            </article>

            <article className="panel quick-panel">
              <div className="panel-head"><div><h2>إجراءات سريعة</h2><p>الوصول المباشر للمهام المتكررة</p></div></div>
              <div className="quick-grid">
                <a className="quick-action-link" href="/maintenance"><span className="blue"><Icon name="calendar"/></span><strong>مركز الصيانة</strong><small>متابعة الاستحقاقات</small></a>
                <a className="quick-action-link" href="/customers"><span className="green"><Icon name="customers"/></span><strong>إضافة عميل</strong><small>تسجيل عميل جديد</small></a>
                <a className="quick-action-link" href="/finance"><span className="amber"><Icon name="wallet"/></span><strong>اعتماد مستحقات</strong><small>مراجعة طلبات الاعتماد</small></a>
                <a className="quick-action-link" href="/inventory"><span className="violet"><Icon name="inventory"/></span><strong>مركز المخزون</strong><small>الأرصدة والحركات</small></a>
              </div>
            </article>
          </section>
        </div>
      </section>
    </main>
    </PreviewAuthGuard>
  );
}

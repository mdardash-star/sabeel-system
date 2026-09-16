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
  { label: "الطلبات والمهام", icon: "orders", badge: 12 },
  { label: "العملاء", icon: "customers" },
  { label: "الفنيون", icon: "tech" },
  { label: "مركز الصيانة", icon: "calendar" },
  { label: "المالية", icon: "wallet" },
  { label: "المخزون", icon: "inventory" },
  { label: "التقارير", icon: "reports" },
];

const stats = [
  { label: "طلبات اليوم", value: "٢٤", change: "+١٢٪", tone: "blue", icon: "orders" as IconName },
  { label: "مهام قيد التنفيذ", value: "١٢", change: "٥ عاجلة", tone: "amber", icon: "clock" as IconName },
  { label: "مهام مكتملة", value: "١٨", change: "+٨٪", tone: "green", icon: "check" as IconName },
  { label: "إيرادات اليوم", value: "٨,٤٥٠", suffix: "ر.س", change: "+١٥٪", tone: "violet", icon: "wallet" as IconName },
];

const jobs = [
  { id: "#SB-1048", customer: "محمد القحطاني", service: "تركيب جهاز ٧ مراحل", tech: "أحمد سعيد", area: "الياسمين", time: "١٠:٣٠ ص", status: "في الطريق", statusClass: "enroute" },
  { id: "#SB-1047", customer: "نورة الدوسري", service: "صيانة دورية", tech: "إسلام محمد", area: "الملقا", time: "١١:٠٠ ص", status: "جاري التنفيذ", statusClass: "working" },
  { id: "#SB-1046", customer: "شركة روافد", service: "تغيير فلاتر جامبو", tech: "حسن علي", area: "السليمانية", time: "١٢:٣٠ م", status: "مجدولة", statusClass: "scheduled" },
  { id: "#SB-1045", customer: "سعد العتيبي", service: "تنظيف وتعقيم خزان", tech: "رمضان حسن", area: "قرطبة", time: "١:٠٠ م", status: "مكتملة", statusClass: "done" },
];

const technicians = [
  { initials: "أ س", name: "أحمد سعيد", tasks: "٤ مهام", state: "متاح", score: "4.9", color: "avatar-blue" },
  { initials: "إ م", name: "إسلام محمد", tasks: "٣ مهام", state: "في مهمة", score: "4.8", color: "avatar-green" },
  { initials: "ح ع", name: "حسن علي", tasks: "٣ مهام", state: "متاح", score: "4.7", color: "avatar-amber" },
  { initials: "ر ح", name: "رمضان حسن", tasks: "٢ مهمة", state: "في مهمة", score: "4.8", color: "avatar-violet" },
];

export default function Dashboard() {
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
            <a className={`nav-item${item.active ? " active" : ""}`} href={item.icon === "orders" ? "/jobs" : item.icon === "customers" ? "/customers" : item.icon === "tech" ? "/technicians" : item.icon === "calendar" ? "/maintenance" : item.icon === "wallet" ? "/finance" : item.icon === "inventory" ? "/inventory" : "#"} key={item.label}>
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
          <div className="demo-notice"><span>نسخة المعاينة</span> البيانات المعروضة تجريبية ولا تؤثر على متجر سبيل المباشر.</div>
          <div className="page-head">
            <div><p>الثلاثاء، ١٥ سبتمبر ٢٠٢٦</p><h1>مرحبًا بك 👋</h1><span>إليك ملخص العمليات في سبيل اليوم</span></div>
            <button className="primary-button"><span>+</span> إنشاء طلب جديد</button>
          </div>

          <section className="stats-grid" aria-label="مؤشرات اليوم">
            {stats.map((stat) => <article className="stat-card" key={stat.label}>
              <div className={`stat-icon ${stat.tone}`}><Icon name={stat.icon}/></div>
              <div className="stat-copy"><span>{stat.label}</span><div><strong>{stat.value}</strong>{stat.suffix && <small>{stat.suffix}</small>}</div><em>{stat.change}</em></div>
            </article>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel jobs-panel">
              <div className="panel-head"><div><h2>مهام اليوم</h2><p>متابعة حالة طلبات التركيب والصيانة</p></div><a href="/jobs">عرض الكل <Icon name="arrow" size={16}/></a></div>
              <div className="table-wrap"><table>
                <thead><tr><th>رقم الطلب</th><th>العميل والخدمة</th><th>الفني</th><th>الموقع والموعد</th><th>الحالة</th><th></th></tr></thead>
                <tbody>{jobs.map((job) => <tr key={job.id}>
                  <td><strong className="order-id">{job.id}</strong></td>
                  <td><strong>{job.customer}</strong><small>{job.service}</small></td>
                  <td>{job.tech}</td>
                  <td><span className="meta"><Icon name="pin" size={14}/>{job.area}</span><small className="meta"><Icon name="clock" size={14}/>{job.time}</small></td>
                  <td><span className={`status ${job.statusClass}`}>{job.status}</span></td>
                  <td><button className="dots" aria-label={`تفاصيل ${job.id}`}>•••</button></td>
                </tr>)}</tbody>
              </table></div>
            </article>

            <article className="panel team-panel">
              <div className="panel-head"><div><h2>الفنيون اليوم</h2><p>حالة الفريق الميداني</p></div><a href="/technicians">عرض الكل</a></div>
              <div className="team-list">{technicians.map((tech) => <div className="tech-row" key={tech.name}>
                <div className={`tech-avatar ${tech.color}`}>{tech.initials}</div>
                <div className="tech-info"><strong>{tech.name}</strong><span>★ {tech.score} · {tech.tasks}</span></div>
                <span className={`availability ${tech.state === "متاح" ? "available" : "busy"}`}><i />{tech.state}</span>
              </div>)}</div>
              <div className="capacity"><div><span>إشغال الفريق</span><strong>٧٥٪</strong></div><div className="progress"><i /></div><p>١٢ من ١٦ فترة عمل محجوزة اليوم</p></div>
            </article>

            <article className="panel chart-panel">
              <div className="panel-head"><div><h2>أداء الطلبات</h2><p>آخر ٧ أيام</p></div><select aria-label="الفترة"><option>هذا الأسبوع</option></select></div>
              <div className="chart-summary"><div><span>إجمالي الطلبات</span><strong>١٣٨</strong><em>↑ ١١.٤٪</em></div><div className="legend"><span><i className="legend-blue"/>الطلبات</span><span><i className="legend-green"/>المكتملة</span></div></div>
              <div className="chart" aria-label="رسم بياني لأداء الطلبات">
                {[{d:"الأربعاء",a:48,b:35},{d:"الخميس",a:65,b:46},{d:"الجمعة",a:40,b:31},{d:"السبت",a:76,b:58},{d:"الأحد",a:58,b:44},{d:"الاثنين",a:86,b:65},{d:"الثلاثاء",a:72,b:57}].map((bar) => <div className="bar-group" key={bar.d}><div className="bars"><i style={{height:`${bar.a}%`}}/><i style={{height:`${bar.b}%`}}/></div><span>{bar.d}</span></div>)}
              </div>
            </article>

            <article className="panel quick-panel">
              <div className="panel-head"><div><h2>إجراءات سريعة</h2><p>الوصول المباشر للمهام المتكررة</p></div></div>
              <div className="quick-grid">
                <a className="quick-action-link" href="/maintenance"><span className="blue"><Icon name="calendar"/></span><strong>مركز الصيانة</strong><small>متابعة الاستحقاقات</small></a>
                <a className="quick-action-link" href="/customers"><span className="green"><Icon name="customers"/></span><strong>إضافة عميل</strong><small>تسجيل عميل جديد</small></a>
                <a className="quick-action-link" href="/finance"><span className="amber"><Icon name="wallet"/></span><strong>اعتماد مستحقات</strong><small>٤ بانتظار الاعتماد</small></a>
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

import PreviewAuthGuard from "./preview-auth-guard";

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

const kpis = [
  ["إجمالي الطلبات اليوم","٢٤","+١٢٪"],
  ["قيد التنفيذ","١٢","٥ عاجلة"],
  ["مكتملة","١٨","+٨٪"],
  ["متأخرة","٣","تحتاج متابعة"],
  ["إيرادات اليوم","٨,٤٥٠ ر.س","+١٥٪"],
  ["متوسط قيمة الطلب","٣٥٢ ر.س","+٦٪"],
  ["عملاء نشطون","١,٢٥٠","+٤.٢٪"],
  ["مزودو خدمة متاحون","٩ / ١٢","٧٥٪ إشغال"],
];

const orderFlow = [
  ["جديدة",32,100],["مؤكدة",26,82],["مجدولة",21,66],["في الطريق",17,53],["قيد التنفيذ",13,41],["مكتملة",18,57]
];

const providers = [
  ["أحمد سعيد","٩٦٪","4.9","١٢ مهمة","٢,٨٤٠ ر.س"],
  ["إسلام محمد","٩٢٪","4.8","١٠ مهام","٢,٤٥٠ ر.س"],
  ["حسن علي","٨٨٪","4.7","٩ مهام","٢,١٢٠ ر.س"],
  ["رمضان حسن","٨٥٪","4.8","٨ مهام","١,٩٨٠ ر.س"],
];

const customers = [
  ["عملاء جدد","١٨٧","+٩٪"],
  ["عملاء متكررون","٤٣٨","+٦٪"],
  ["VIP","١٢٦","+٣٪"],
  ["معرضون للفقد","٩٤","Churn ٨٪"],
  ["صيانة مستحقة 30 يوم","٨٤","فرصة احتفاظ"],
  ["سلات متروكة","٨","٦,٤٥٠ ر.س"],
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

const alerts = [
  ["٣ طلبات متأخرة","تشغيلي","/jobs"],
  ["٨٤ عميل صيانته مستحقة","احتفاظ","/maintenance"],
  ["٨ سلات متروكة بقيمة ٦,٤٥٠ ر.س","تسويق","/marketing/abandoned-carts"],
  ["٤ أصناف تحت حد إعادة الطلب","مخزون","/inventory"],
  ["مزود خدمة واحد تجاوز الطاقة اليومية","تشغيل","/technicians"],
];

export default function Dashboard(){
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
            <div><span>SUBIL OS</span><h1>صورة كاملة للنشاط في شاشة واحدة</h1><p>متابعة لحظية لحركة الطلبات، العملاء، مزودي الخدمة، الإيرادات، المخزون والتسويق مع تنبيهات وفرص نمو قابلة للتنفيذ.</p></div>
            <div className="hero-score"><small>مؤشر صحة التشغيل</small><strong>٩١٪</strong><span>مستقر</span></div>
          </section>

          <section className="executive-kpis">
            {kpis.map(([l,v,c])=><article key={l}><span>{l}</span><strong>{v}</strong><small>{c}</small></article>)}
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>حركة الطلبات</h2><p>مسار الطلب من الإنشاء حتى الإغلاق</p></div><a href="/jobs">كل الطلبات</a></header>
              <div className="order-funnel">
                {orderFlow.map(([label,count,width])=><div key={label}><div><span>{label}</span><b>{count}</b></div><i><em style={{width:`${width}%`}} /></i></div>)}
              </div>
              <div className="mini-summary"><span>نسبة الإكمال <b>٧٥٪</b></span><span>متوسط زمن التنفيذ <b>٢.٨ ساعة</b></span><span>SLA <b>٩٢٪</b></span></div>
            </article>

            <article className="exec-panel">
              <header><div><h2>التنبيهات التنفيذية</h2><p>أهم ما يحتاج تدخل اليوم</p></div><a href="/ai/insights">تحليل أعمق</a></header>
              <div className="exec-alerts">{alerts.map(([t,tag,href])=><a href={href} key={t}><div><strong>{t}</strong><small>{tag}</small></div><b>←</b></a>)}</div>
            </article>
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>تحليل مزودي الخدمة</h2><p>الإنتاجية، الجودة، الإيراد والطاقة التشغيلية</p></div><a href="/technicians">عرض المزودين</a></header>
              <div className="provider-table">
                <div className="provider-head"><span>المزود</span><span>الالتزام</span><span>التقييم</span><span>المهام</span><span>الإيراد</span></div>
                {providers.map(r=><div key={r[0]}>{r.map((x,i)=><span key={i}>{x}</span>)}</div>)}
              </div>
            </article>

            <article className="exec-panel">
              <header><div><h2>تحليل العملاء</h2><p>النمو، الاحتفاظ، القيمة والمخاطر</p></div><a href="/customers">قاعدة العملاء</a></header>
              <div className="customer-matrix">{customers.map(([l,v,n])=><div key={l}><span>{l}</span><strong>{v}</strong><small>{n}</small></div>)}</div>
            </article>
          </section>

          <section className="executive-grid three">
            <article className="exec-panel revenue-panel">
              <header><div><h2>الإيرادات والربحية</h2><p>ملخص مالي سريع</p></div><a href="/finance">المالية</a></header>
              <div className="big-number">١٨٢,٤٥٠ <small>ر.س هذا الشهر</small></div>
              <div className="metric-row"><span>هامش المساهمة <b>٣٨٪</b></span><span>متوسط الطلب <b>٣٥٢ ر.س</b></span><span>المتوقع 30 يوم <b>٢٢٤ ألف</b></span></div>
            </article>
            <article className="exec-panel">
              <header><div><h2>المخزون</h2><p>حالة التوفر</p></div><a href="/inventory">المخزون</a></header>
              <div className="stock-health"><strong>٩٤٪</strong><span>توفر الأصناف</span></div>
              <ul className="simple-list"><li>٤ أصناف تحت الحد</li><li>٢ طلب شراء مفتوح</li><li>١٢ حركة اليوم</li></ul>
            </article>
            <article className="exec-panel">
              <header><div><h2>الصيانة والاستحقاقات</h2><p>فرص الخدمة القادمة</p></div><a href="/maintenance">مركز الصيانة</a></header>
              <div className="stock-health"><strong>٨٤</strong><span>استحقاق خلال 30 يوم</span></div>
              <ul className="simple-list"><li>٣٢ هذا الأسبوع</li><li>١٨ عالية القيمة</li><li>١١ بحاجة تأكيد</li></ul>
            </article>
          </section>

          <section className="exec-panel cmo-command">
            <header><div><h2>CMO / مركز النمو والتسويق الذكي</h2><p>كل محركات النمو والتحليل التسويقي في مكان واحد</p></div><a href="/marketing/growth">فتح CMO الكامل</a></header>
            <div className="cmo-grid">{cmo.map(([t,d])=><a href="/marketing/growth" key={t}><strong>{t}</strong><span>{d}</span><b>←</b></a>)}</div>
          </section>

          <section className="executive-grid two">
            <article className="exec-panel">
              <header><div><h2>القنوات والأداء التسويقي</h2><p>مقارنة العائد حسب القناة</p></div><a href="/marketing/growth">التفاصيل</a></header>
              <div className="channel-bars">
                {[["Google","5.8×",88],["WhatsApp","4.9×",75],["Organic","4.6×",71],["Instagram","2.3×",39]].map(([n,v,w])=><div key={n}><span>{n}</span><i><em style={{width:`${w}%`}} /></i><b>{v}</b></div>)}
              </div>
            </article>
            <article className="exec-panel">
              <header><div><h2>ملخص الإدارة التنفيذي</h2><p>Executive Brief</p></div><a href="/marketing/growth">CMO Brief</a></header>
              <div className="brief-box">
                <strong>الأولوية اليوم: الاحتفاظ ورفع قيمة الطلب</strong>
                <p>أقوى فرصة حالية هي تحويل استحقاقات الصيانة والسلات المتروكة إلى حملات موجهة، مع مراقبة مزود الخدمة الأعلى ضغطًا وتحسين مخزون الأصناف الحرجة.</p>
                <div><span>فرصة إيراد: <b>+٢١,٤٠٠ ر.س</b></span><span>مخاطر تشغيل: <b>٣</b></span></div>
              </div>
            </article>
          </section>
        </div>
      </section>
    </main>
  </PreviewAuthGuard>;
}

import PreviewAuthGuard from "../../preview-auth-guard";

const customers = {
  "CUS-1048": { name:"محمد القحطاني", phone:"055 482 1930", email:"m.alqahtani@example.com", area:"الياسمين", since:"مارس ٢٠٢٤", orders:"٦", value:"٧,٨٤٠ ر.س" },
  "CUS-1047": { name:"نورة الدوسري", phone:"053 761 4280", email:"n.aldosari@example.com", area:"الملقا", since:"نوفمبر ٢٠٢٤", orders:"٣", value:"٣,٢٥٠ ر.س" },
  "CUS-1046": { name:"شركة روافد", phone:"011 452 7300", email:"ops@rawafed.example.com", area:"السليمانية", since:"يناير ٢٠٢٣", orders:"٨", value:"١٤,٩٠٠ ر.س" },
  "CUS-1045": { name:"سعد العتيبي", phone:"050 339 8124", email:"s.alotaibi@example.com", area:"قرطبة", since:"سبتمبر ٢٠٢٦", orders:"١", value:"١,٤٥٠ ر.س" },
} as const;

const orderRows = [
  {id:"#SB-1048",service:"تركيب جهاز ٧ مراحل",date:"١٥ سبتمبر ٢٠٢٦",status:"في الطريق",tone:"enroute"},
  {id:"#SB-0982",service:"تغيير فلاتر",date:"١٢ يونيو ٢٠٢٦",status:"مكتملة",tone:"done"},
  {id:"#SB-0814",service:"صيانة دورية",date:"١٠ مارس ٢٠٢٦",status:"مكتملة",tone:"done"},
];

export default async function CustomerDetails({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const customer=customers[id as keyof typeof customers] ?? customers["CUS-1048"];
  return <PreviewAuthGuard><main className="customers-page">
    <header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><div className="profile-avatar">م</div></header>
    <div className="customers-wrap">
      <a className="back-link" href="/customers">→ العودة إلى العملاء</a>
      <div className="customer-profile-head"><div className="customer-avatar">{customer.name.slice(0,1)}</div><div><p>{id}</p><h1>{customer.name}</h1><span className="status done">عميل نشط</span></div><button className="secondary-button">تعديل البيانات</button></div>
      <section className="customer-detail-grid">
        <article className="panel detail-card"><h2>بيانات التواصل</h2><dl><div><dt>رقم الجوال</dt><dd dir="ltr">{customer.phone}</dd></div><div><dt>البريد الإلكتروني</dt><dd>{customer.email}</dd></div><div><dt>المنطقة</dt><dd>{customer.area}، الرياض</dd></div><div><dt>عميل منذ</dt><dd>{customer.since}</dd></div></dl></article>
        <article className="panel detail-card"><h2>ملخص العميل</h2><div className="detail-metrics"><div><span>إجمالي الطلبات</span><strong>{customer.orders}</strong></div><div><span>إجمالي القيمة</span><strong>{customer.value}</strong></div></div></article>
        <article className="panel detail-card asset-card"><h2>الأجهزة والأصول</h2><div className="asset-row"><div><strong>جهاز سبيل ٧ مراحل</strong><span>الرقم التسلسلي: SBL-7-29418</span></div><span className="status done">الضمان ساري</span></div><p>موعد الصيانة القادم: ١٥ ديسمبر ٢٠٢٦</p></article>
        <article className="panel detail-orders"><div className="panel-head"><div><h2>آخر الطلبات</h2><p>سجل خدمات العميل</p></div></div><div className="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>الخدمة</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>{orderRows.map(order=><tr key={order.id}><td><strong className="order-id">{order.id}</strong></td><td>{order.service}</td><td>{order.date}</td><td><span className={`status ${order.tone}`}>{order.status}</span></td></tr>)}</tbody></table></div></article>
      </section>
    </div>
  </main></PreviewAuthGuard>;
}

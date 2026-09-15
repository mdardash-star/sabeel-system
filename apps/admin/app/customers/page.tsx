"use client";

import { FormEvent, useMemo, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

type Customer = { id:string; name:string; phone:string; area:string; orders:number; lastOrder:string; status:"نشط"|"جديد" };

const seed: Customer[] = [
  { id:"CUS-1048", name:"محمد القحطاني", phone:"055 482 1930", area:"الياسمين", orders:6, lastOrder:"اليوم، ١٠:٣٠ ص", status:"نشط" },
  { id:"CUS-1047", name:"نورة الدوسري", phone:"053 761 4280", area:"الملقا", orders:3, lastOrder:"أمس، ٤:١٥ م", status:"نشط" },
  { id:"CUS-1046", name:"شركة روافد", phone:"011 452 7300", area:"السليمانية", orders:8, lastOrder:"١٣ سبتمبر ٢٠٢٦", status:"نشط" },
  { id:"CUS-1045", name:"سعد العتيبي", phone:"050 339 8124", area:"قرطبة", orders:1, lastOrder:"١٢ سبتمبر ٢٠٢٦", status:"جديد" },
];

export default function CustomersPage() {
  const [customers,setCustomers] = useState(seed);
  const [query,setQuery] = useState("");
  const [open,setOpen] = useState(false);
  const [error,setError] = useState("");
  const shown = useMemo(() => {
    const q=query.trim().toLowerCase();
    return q ? customers.filter(c => [c.id,c.name,c.phone,c.area].some(v => v.toLowerCase().includes(q))) : customers;
  },[customers,query]);

  function close(){ setError(""); setOpen(false); }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const name=String(data.get("name")||"").trim(), area=String(data.get("area")||"").trim();
    const phone=String(data.get("phone")||"").replace(/\D/g,"");
    if(name.length<2 || area.length<2 || !/^05\d{8}$/.test(phone)){ setError("أدخل الاسم والمنطقة ورقم جوال سعودي صحيحًا يبدأ بـ 05."); return; }
    setCustomers(list => [{id:`CUS-${1049+list.length}`,name,area,phone:phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"),orders:0,lastOrder:"لا توجد طلبات",status:"جديد"},...list]);
    close();
  }

  return <PreviewAuthGuard><main className="customers-page">
    <header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><div className="profile-avatar">م</div></header>
    <div className="customers-wrap">
      <div className="demo-notice"><span>نسخة المعاينة</span> بيانات العملاء تجريبية ولا تؤثر على متجر سبيل المباشر.</div>
      <div className="page-head"><div><p>إدارة علاقات العملاء</p><h1>العملاء</h1><span>عرض بيانات العملاء وسجل طلباتهم</span></div><button className="primary-button" onClick={()=>setOpen(true)}><span>+</span> إضافة عميل</button></div>
      <section className="customer-stats" aria-label="ملخص العملاء"><article><span>إجمالي العملاء</span><strong>{customers.length.toLocaleString("ar-SA")}</strong></article><article><span>عملاء جدد هذا الشهر</span><strong>١٢</strong></article><article><span>لديهم طلب نشط</span><strong>١٨</strong></article></section>
      <article className="panel"><div className="customers-toolbar"><div><h2>قائمة العملاء</h2><p>{shown.length.toLocaleString("ar-SA")} نتيجة</p></div><input aria-label="بحث العملاء" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث بالاسم، الجوال، المنطقة أو الرقم..." /></div>
        <div className="table-wrap"><table><thead><tr><th>العميل</th><th>الجوال</th><th>المنطقة</th><th>الطلبات</th><th>آخر طلب</th><th>الحالة</th></tr></thead><tbody>{shown.map(c=><tr key={c.id}><td><strong>{c.name}</strong><small>{c.id}</small></td><td dir="ltr">{c.phone}</td><td>{c.area}</td><td>{c.orders.toLocaleString("ar-SA")}</td><td>{c.lastOrder}</td><td><span className={`status ${c.status==="نشط"?"done":"scheduled"}`}>{c.status}</span></td></tr>)}</tbody></table>{!shown.length&&<div className="empty-state">لا توجد نتائج مطابقة للبحث.</div>}</div>
      </article>
    </div>
    {open&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><div className="modal-head"><div><h2 id="add-title">إضافة عميل جديد</h2><p>أدخل البيانات الأساسية للعميل</p></div><button aria-label="إغلاق" onClick={close}>×</button></div><form onSubmit={submit}><label>اسم العميل<input name="name" autoFocus placeholder="الاسم الكامل" /></label><label>رقم الجوال<input name="phone" dir="ltr" inputMode="numeric" placeholder="05XXXXXXXX" /></label><label>المنطقة<input name="area" placeholder="مثال: الياسمين" /></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>إلغاء</button><button className="primary-button" type="submit">حفظ العميل</button></div></form></section></div>}
  </main></PreviewAuthGuard>;
}

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

const apiBase = process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/, "") || "";

type Customer = { id:string; name:string; phone:string; area:string; orders:number; lastOrder:string; status:"نشط"|"جديد" };
type CustomerStats = { total:number; new_this_month:number; with_orders:number };

const seed: Customer[] = [
  { id:"CUS-1048", name:"محمد القحطاني", phone:"055 482 1930", area:"الياسمين", orders:6, lastOrder:"اليوم، ١٠:٣٠ ص", status:"نشط" },
  { id:"CUS-1047", name:"نورة الدوسري", phone:"053 761 4280", area:"الملقا", orders:3, lastOrder:"أمس، ٤:١٥ م", status:"نشط" },
  { id:"CUS-1046", name:"شركة روافد", phone:"011 452 7300", area:"السليمانية", orders:8, lastOrder:"١٣ سبتمبر ٢٠٢٦", status:"نشط" },
  { id:"CUS-1045", name:"سعد العتيبي", phone:"050 339 8124", area:"قرطبة", orders:1, lastOrder:"١٢ سبتمبر ٢٠٢٦", status:"جديد" },
];

export default function CustomersPage() {
  const [customers,setCustomers] = useState<Customer[]>(apiBase ? [] : seed);
  const [query,setQuery] = useState("");
  const [search,setSearch] = useState("");
  const [page,setPage] = useState(0);
  const [resultTotal,setResultTotal] = useState(seed.length);
  const [stats,setStats] = useState<CustomerStats>({total:seed.length,new_this_month:1,with_orders:3});
  const [reloadKey,setReloadKey] = useState(0);
  const [open,setOpen] = useState(false);
  const [error,setError] = useState("");
  const [pageError,setPageError] = useState("");
  const [loading,setLoading] = useState(Boolean(apiBase));
  const shown = useMemo(() => {
    const q=query.trim().toLowerCase();
    if(apiBase)return customers;
    return q ? customers.filter(c => [c.id,c.name,c.phone,c.area].some(v => v.toLowerCase().includes(q))) : customers;
  },[customers,query]);

  useEffect(() => {
    if(!apiBase)return;
    const timer=window.setTimeout(()=>{setPage(0);setSearch(query.trim());},300);
    return()=>window.clearTimeout(timer);
  },[query]);

  useEffect(() => {
    if (!apiBase) return;
    const token=sessionStorage.getItem("subil_session");
    const controller=new AbortController();
    const params=new URLSearchParams({limit:"20",offset:String(page*20)});
    if(search)params.set("q",search);
    setLoading(true);
    fetch(`${apiBase}/api/v1/customers?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response => {
        if(!response.ok) throw new Error(response.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل العملاء.");
        return response.json();
      })
      .then(payload => {
        setCustomers((payload.customers||[]).map((customer:Record<string,unknown>) => ({
          id:String(customer.id), name:String(customer.name||"بدون اسم"), phone:String(customer.mobile||"—"),
          area:String(customer.address_text||customer.city_id||"—"), orders:Number(customer.order_count||0),
          lastOrder:customer.last_order_at?new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"}).format(new Date(String(customer.last_order_at))):"لا توجد طلبات",
          status:Number(customer.order_count||0)>0?"نشط":"جديد",
        })));
        setResultTotal(Number(payload.pagination?.total||0));
        setPageError("");
      })
      .catch((fetchError:unknown) => {
        if(fetchError instanceof DOMException && fetchError.name==="AbortError") return;
        setPageError(fetchError instanceof Error?fetchError.message:"تعذر تحميل العملاء.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  },[page,reloadKey,search]);

  useEffect(() => {
    if(!apiBase)return;
    const token=sessionStorage.getItem("subil_session"),controller=new AbortController();
    fetch(`${apiBase}/api/v1/customers/stats`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("تعذر تحميل إحصاءات العملاء.");return response.json();})
      .then(payload=>setStats(payload.stats))
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setPageError(reason instanceof Error?reason.message:"تعذر تحميل إحصاءات العملاء.");});
    return()=>controller.abort();
  },[reloadKey]);

  function close(){ setError(""); setOpen(false); }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const name=String(data.get("name")||"").trim(), area=String(data.get("area")||"").trim();
    const phone=String(data.get("phone")||"").replace(/\D/g,"");
    if(name.length<2 || area.length<2 || !/^05\d{8}$/.test(phone)){ setError("أدخل الاسم والمنطقة ورقم جوال سعودي صحيحًا يبدأ بـ 05."); return; }
    setLoading(true);
    try {
      let created:Customer={id:`CUS-${1049+customers.length}`,name,area,phone:phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"),orders:0,lastOrder:"لا توجد طلبات",status:"جديد"};
      if(apiBase){
        const token=sessionStorage.getItem("subil_session");
        const response=await fetch(`${apiBase}/api/v1/customers`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({name,mobile:phone,cityId:"riyadh",addressText:area})});
        const payload=await response.json();
        if(!response.ok) throw new Error(payload.error==="mobile_already_exists"?"رقم الجوال مسجل لعميل آخر.":"تعذر حفظ العميل.");
        created={...created,id:String(payload.customer.id),phone:String(payload.customer.mobile||created.phone)};
      }
      if(apiBase){setQuery("");setSearch("");setPage(0);setReloadKey(value=>value+1);}
      else{setCustomers(list=>[created,...list]);setResultTotal(value=>value+1);setStats(value=>({...value,total:value.total+1,new_this_month:value.new_this_month+1}));}
      setPageError(""); close();
    } catch(saveError) { setError(saveError instanceof Error?saveError.message:"تعذر حفظ العميل."); }
    finally { setLoading(false); }
  }

  return <PreviewAuthGuard><main className="customers-page">
    <header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><nav className="section-nav" aria-label="تنقل الأقسام"><a href="/">لوحة التحكم</a><a href="/jobs">المهام</a><a className="active" href="/customers">العملاء</a><a href="/technicians">الفنيون</a><a href="/maintenance">الصيانة</a></nav><div className="profile-avatar">م</div></header>
    <div className="customers-wrap">
      <div className="demo-notice"><span>نسخة المعاينة</span> بيانات العملاء تجريبية ولا تؤثر على متجر سبيل المباشر.</div>
      <div className="page-head"><div><p>إدارة علاقات العملاء</p><h1>العملاء</h1><span>عرض بيانات العملاء وسجل طلباتهم</span></div><button className="primary-button" onClick={()=>setOpen(true)}><span>+</span> إضافة عميل</button></div>
      <section className="customer-stats" aria-label="ملخص العملاء"><article><span>إجمالي العملاء</span><strong>{stats.total.toLocaleString("ar-SA")}</strong></article><article><span>عملاء جدد هذا الشهر</span><strong>{stats.new_this_month.toLocaleString("ar-SA")}</strong></article><article><span>لديهم طلبات</span><strong>{stats.with_orders.toLocaleString("ar-SA")}</strong></article></section>
      {pageError&&<div className="api-error" role="alert">{pageError}</div>}
      <article className="panel"><div className="customers-toolbar"><div><h2>قائمة العملاء</h2><p>{loading?"جارٍ التحميل...":`${(apiBase?resultTotal:shown.length).toLocaleString("ar-SA")} نتيجة`}</p></div><input aria-label="بحث العملاء" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث بالاسم، الجوال، المنطقة أو الرقم..." /></div>
        <div className="table-wrap"><table><thead><tr><th>العميل</th><th>الجوال</th><th>المنطقة</th><th>الطلبات</th><th>آخر طلب</th><th>الحالة</th></tr></thead><tbody>{shown.map(c=><tr key={c.id}><td><a className="customer-name-link" href={`/customers/${c.id}`}><strong>{c.name}</strong><small>{c.id}</small></a></td><td dir="ltr">{c.phone}</td><td>{c.area}</td><td>{c.orders.toLocaleString("ar-SA")}</td><td>{c.lastOrder}</td><td><span className={`status ${c.status==="نشط"?"done":"scheduled"}`}>{c.status}</span></td></tr>)}</tbody></table>{!shown.length&&<div className="empty-state">لا توجد نتائج مطابقة للبحث.</div>}</div>
        {apiBase&&resultTotal>20&&<nav className="customers-pagination" aria-label="صفحات العملاء"><button className="secondary-button" disabled={loading||page===0} onClick={()=>setPage(value=>Math.max(0,value-1))}>السابق</button><span>صفحة {(page+1).toLocaleString("ar-SA")} من {Math.ceil(resultTotal/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={loading||(page+1)*20>=resultTotal} onClick={()=>setPage(value=>value+1)}>التالي</button></nav>}
      </article>
    </div>
    {open&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)close();}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><div className="modal-head"><div><h2 id="add-title">إضافة عميل جديد</h2><p>أدخل البيانات الأساسية للعميل</p></div><button aria-label="إغلاق" disabled={loading} onClick={close}>×</button></div><form onSubmit={submit}><label>اسم العميل<input name="name" autoFocus disabled={loading} placeholder="الاسم الكامل" /></label><label>رقم الجوال<input name="phone" dir="ltr" inputMode="numeric" disabled={loading} placeholder="05XXXXXXXX" /></label><label>المنطقة<input name="area" disabled={loading} placeholder="مثال: الياسمين" /></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={loading} onClick={close}>إلغاء</button><button className="primary-button" disabled={loading} type="submit">{loading?"جارٍ الحفظ...":"حفظ العميل"}</button></div></form></section></div>}
  </main></PreviewAuthGuard>;
}

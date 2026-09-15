"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PreviewAuthGuard from "../../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type Address={id?:string;city_id?:string;address_text?:string};
type Asset={id?:string;product_id?:string;serial_number?:string;warranty_ends_at?:string;next_maintenance_at?:string;status?:string};
type Order={id?:string;external_order_id?:string;created_at?:string;paid_at?:string;total_ex_vat?:string};
type Customer={id:string;name:string;mobile?:string;created_at?:string;addresses:Address[];assets:Asset[];orders:Order[]};

const previews:Record<string,Customer>={
  "CUS-1048":{id:"CUS-1048",name:"محمد القحطاني",mobile:"055 482 1930",created_at:"2024-03-10",addresses:[{id:"a1",city_id:"الرياض",address_text:"حي الياسمين"}],assets:[{id:"as1",product_id:"جهاز سبيل ٧ مراحل",serial_number:"SBL-7-29418",warranty_ends_at:"2027-03-10",next_maintenance_at:"2026-12-15",status:"active"}],orders:[{id:"SB-1048",external_order_id:"1048",created_at:"2026-09-15",paid_at:"2026-09-15",total_ex_vat:"1450"},{id:"SB-0982",external_order_id:"982",created_at:"2026-06-12",paid_at:"2026-06-12",total_ex_vat:"620"}]},
  "CUS-1047":{id:"CUS-1047",name:"نورة الدوسري",mobile:"053 761 4280",created_at:"2024-11-05",addresses:[{id:"a2",city_id:"الرياض",address_text:"حي الملقا"}],assets:[],orders:[]},
  "CUS-1046":{id:"CUS-1046",name:"شركة روافد",mobile:"011 452 7300",created_at:"2023-01-20",addresses:[{id:"a3",city_id:"الرياض",address_text:"حي السليمانية"}],assets:[],orders:[]},
  "CUS-1045":{id:"CUS-1045",name:"سعد العتيبي",mobile:"050 339 8124",created_at:"2026-09-12",addresses:[{id:"a4",city_id:"الرياض",address_text:"حي قرطبة"}],assets:[],orders:[]},
};
const formatter=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"});
function date(value?:string){return value?formatter.format(new Date(value)):"—";}

export default function CustomerDetails(){
  const params=useParams<{id:string}>(),id=decodeURIComponent(params.id);
  const [customer,setCustomer]=useState<Customer|null>(apiBase?null:(previews[id]||previews["CUS-1048"]));
  const [loading,setLoading]=useState(Boolean(apiBase));
  const [error,setError]=useState("");
  const [editOpen,setEditOpen]=useState(false);
  const [editError,setEditError]=useState("");
  const [updating,setUpdating]=useState(false);
  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session");
    fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(response.status===404?"لم يتم العثور على العميل.":response.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل بيانات العميل.");return response.json();})
      .then(payload=>setCustomer({...payload.customer,addresses:payload.customer.addresses||[],assets:payload.customer.assets||[],orders:payload.customer.orders||[]}))
      .catch((reason:unknown)=>{if(reason instanceof DOMException&&reason.name==="AbortError")return;setError(reason instanceof Error?reason.message:"تعذر تحميل بيانات العميل.");})
      .finally(()=>setLoading(false));
    return()=>controller.abort();
  },[id]);
  async function updateCustomer(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!customer)return;
    const data=new FormData(event.currentTarget),name=String(data.get("name")||"").trim(),mobile=String(data.get("mobile")||"").trim();
    if(name.length<2||mobile.replace(/\D/g,"").length<9){setEditError("أدخل اسمًا ورقم جوال صحيحين.");return;}
    setUpdating(true);
    try{
      let updated={...customer,name,mobile};
      if(apiBase){
        const token=sessionStorage.getItem("subil_session");
        const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({name,mobile})});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error==="mobile_already_exists"?"رقم الجوال مسجل لعميل آخر.":"تعذر تحديث بيانات العميل.");
        updated={...updated,...payload.customer};
      }
      setCustomer(updated);setEditError("");setEditOpen(false);
    }catch(reason){setEditError(reason instanceof Error?reason.message:"تعذر تحديث بيانات العميل.");}
    finally{setUpdating(false);}
  }
  const total=useMemo(()=>customer?.orders.reduce((sum,order)=>sum+Number(order.total_ex_vat||0),0)||0,[customer]);
  return <PreviewAuthGuard><main className="customers-page"><header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><div className="profile-avatar">م</div></header><div className="customers-wrap"><a className="back-link" href="/customers">→ العودة إلى العملاء</a>
    {loading&&<div className="detail-loading" role="status">جارٍ تحميل بيانات العميل...</div>}{error&&<div className="api-error" role="alert">{error}</div>}
    {customer&&!loading&&<><div className="customer-profile-head"><div className="customer-avatar">{customer.name.slice(0,1)}</div><div><p>{customer.id}</p><h1>{customer.name}</h1><span className="status done">عميل نشط</span></div><button className="secondary-button" onClick={()=>setEditOpen(true)}>تعديل البيانات</button></div><section className="customer-detail-grid">
      <article className="panel detail-card"><h2>بيانات التواصل والعناوين</h2><dl><div><dt>رقم الجوال</dt><dd dir="ltr">{customer.mobile||"—"}</dd></div><div><dt>عميل منذ</dt><dd>{date(customer.created_at)}</dd></div>{customer.addresses.map((item,index)=><div key={item.id||index}><dt>العنوان {index+1}</dt><dd>{item.address_text||"—"}{item.city_id?`، ${item.city_id}`:""}</dd></div>)}</dl></article>
      <article className="panel detail-card"><h2>ملخص العميل</h2><div className="detail-metrics"><div><span>إجمالي الطلبات</span><strong>{customer.orders.length.toLocaleString("ar-SA")}</strong></div><div><span>إجمالي القيمة</span><strong>{total.toLocaleString("ar-SA")} ر.س</strong></div></div></article>
      <article className="panel detail-card asset-card"><h2>الأجهزة والأصول</h2>{customer.assets.length?customer.assets.map((asset,index)=><div className="asset-record" key={asset.id||index}><div className="asset-row"><div><strong>{asset.product_id||"جهاز سبيل"}</strong><span>الرقم التسلسلي: {asset.serial_number||"—"}</span></div><span className={`status ${asset.status==="active"?"done":"scheduled"}`}>{asset.status==="active"?"نشط":"غير نشط"}</span></div><p>الضمان حتى {date(asset.warranty_ends_at)} · الصيانة القادمة {date(asset.next_maintenance_at)}</p></div>):<div className="inline-empty">لا توجد أجهزة مسجلة لهذا العميل.</div>}</article>
      <article className="panel detail-orders"><div className="panel-head"><div><h2>آخر الطلبات</h2><p>سجل خدمات العميل</p></div></div>{customer.orders.length?<div className="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>{customer.orders.map((order,index)=><tr key={order.id||index}><td><strong className="order-id">#{order.external_order_id||order.id}</strong></td><td>{date(order.created_at)}</td><td>{Number(order.total_ex_vat||0).toLocaleString("ar-SA")} ر.س</td><td><span className={`status ${order.paid_at?"done":"working"}`}>{order.paid_at?"مدفوع":"قيد المعالجة"}</span></td></tr>)}</tbody></table></div>:<div className="inline-empty">لا توجد طلبات مسجلة لهذا العميل.</div>}</article>
    </section></>}{editOpen&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setEditOpen(false);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-head"><div><h2 id="edit-title">تعديل بيانات العميل</h2><p>تحديث الاسم ورقم الجوال</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setEditOpen(false)}>×</button></div><form onSubmit={updateCustomer}><label>اسم العميل<input name="name" defaultValue={customer.name} disabled={updating} autoFocus /></label><label>رقم الجوال<input name="mobile" defaultValue={customer.mobile} disabled={updating} dir="ltr" inputMode="tel" /></label>{editError&&<p className="form-error" role="alert">{editError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setEditOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"حفظ التعديلات"}</button></div></form></section></div>}</div></main></PreviewAuthGuard>;
}

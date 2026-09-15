"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PreviewAuthGuard from "../../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type Address={id?:string;city_id?:string;address_text?:string};
type Asset={id?:string;product_id?:string;serial_number?:string;installed_at?:string;warranty_ends_at?:string;next_maintenance_at?:string;maintenance_interval_months?:number;status?:string};
type Order={id?:string;external_order_id?:string;created_at?:string;paid_at?:string;total_ex_vat?:string};
type Customer={id:string;name:string;mobile?:string;created_at?:string;order_count?:number;order_total_ex_vat?:string;addresses:Address[];assets:Asset[];orders:Order[]};
type TimelineEvent={id:string;type:"order"|"job"|"notification";reference?:string;status?:string;occurred_at?:string};

const previews:Record<string,Customer>={
  "CUS-1048":{id:"CUS-1048",name:"محمد القحطاني",mobile:"055 482 1930",created_at:"2024-03-10",addresses:[{id:"a1",city_id:"الرياض",address_text:"حي الياسمين"}],assets:[{id:"as1",product_id:"جهاز سبيل ٧ مراحل",serial_number:"SBL-7-29418",warranty_ends_at:"2027-03-10",next_maintenance_at:"2026-12-15",status:"active"}],orders:[{id:"SB-1048",external_order_id:"1048",created_at:"2026-09-15",paid_at:"2026-09-15",total_ex_vat:"1450"},{id:"SB-0982",external_order_id:"982",created_at:"2026-06-12",paid_at:"2026-06-12",total_ex_vat:"620"}]},
  "CUS-1047":{id:"CUS-1047",name:"نورة الدوسري",mobile:"053 761 4280",created_at:"2024-11-05",addresses:[{id:"a2",city_id:"الرياض",address_text:"حي الملقا"}],assets:[],orders:[]},
  "CUS-1046":{id:"CUS-1046",name:"شركة روافد",mobile:"011 452 7300",created_at:"2023-01-20",addresses:[{id:"a3",city_id:"الرياض",address_text:"حي السليمانية"}],assets:[],orders:[]},
  "CUS-1045":{id:"CUS-1045",name:"سعد العتيبي",mobile:"050 339 8124",created_at:"2026-09-12",addresses:[{id:"a4",city_id:"الرياض",address_text:"حي قرطبة"}],assets:[],orders:[]},
};
const formatter=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"});
const today=new Date().toISOString().slice(0,10);
function date(value?:string){return value?formatter.format(new Date(value)):"—";}
function nextMaintenance(value:string,months:number){const result=new Date(`${value}T00:00:00Z`),day=result.getUTCDate();result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()+months);const lastDay=new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();result.setUTCDate(Math.min(day,lastDay));return result.toISOString();}

export default function CustomerDetails(){
  const params=useParams<{id:string}>(),id=decodeURIComponent(params.id);
  const [customer,setCustomer]=useState<Customer|null>(apiBase?null:(previews[id]||previews["CUS-1048"]));
  const [loading,setLoading]=useState(Boolean(apiBase));
  const [error,setError]=useState("");
  const [editOpen,setEditOpen]=useState(false);
  const [editError,setEditError]=useState("");
  const [updating,setUpdating]=useState(false);
  const [addressOpen,setAddressOpen]=useState(false);
  const [assetOpen,setAssetOpen]=useState(false);
  const [assetError,setAssetError]=useState("");
  const [timeline,setTimeline]=useState<TimelineEvent[]>([]);
  const [orderPage,setOrderPage]=useState(0);
  const [orderTotal,setOrderTotal]=useState(apiBase?0:(previews[id]||previews["CUS-1048"]).orders.length);
  const [orderLoading,setOrderLoading]=useState(false);
  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session");
    const headers={Authorization:`Bearer ${token}`};
    const customerPath=`${apiBase}/api/v1/customers/${encodeURIComponent(id)}`;
    Promise.all([
      fetch(customerPath,{headers,signal:controller.signal}),
      fetch(`${customerPath}/timeline`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/addresses?limit=100`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/assets?limit=100`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/orders?limit=20`,{headers,signal:controller.signal})
    ])
      .then(async([details,history,addresses,assets,orders])=>{
        if(!details.ok)throw new Error(details.status===404?"لم يتم العثور على العميل.":details.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل بيانات العميل.");
        const [payload,timelinePayload,addressPayload,assetPayload,orderPayload]=await Promise.all([
          details.json(),history.ok?history.json():Promise.resolve({timeline:[]}),
          addresses.ok?addresses.json():Promise.resolve({addresses:null}),
          assets.ok?assets.json():Promise.resolve({assets:null}),
          orders.ok?orders.json():Promise.resolve({orders:[],pagination:{total:0}})
        ]);
        return{payload,timelinePayload,addressPayload,assetPayload,orderPayload};
      })
      .then(({payload,timelinePayload,addressPayload,assetPayload,orderPayload})=>{
        setCustomer({...payload.customer,addresses:addressPayload.addresses??[],assets:assetPayload.assets??[],orders:orderPayload.orders??[]});
        setTimeline(timelinePayload.timeline||[]);
        setOrderTotal(Number(orderPayload.pagination?.total||payload.customer.order_count||0));
        setOrderPage(0);
      })
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
  async function addAddress(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!customer)return;const data=new FormData(event.currentTarget),cityId=String(data.get("cityId")||"").trim(),addressText=String(data.get("addressText")||"").trim();if(cityId.length<2||addressText.length<3){setEditError("أدخل المدينة والعنوان بشكل صحيح.");return;}setUpdating(true);try{let address:Address={id:`preview-${Date.now()}`,city_id:cityId,address_text:addressText};if(apiBase){const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/addresses`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({cityId,addressText})});const payload=await response.json();if(!response.ok)throw new Error("تعذر حفظ العنوان.");address=payload.address;}setCustomer({...customer,addresses:[address,...customer.addresses]});setEditError("");setAddressOpen(false);}catch(reason){setEditError(reason instanceof Error?reason.message:"تعذر حفظ العنوان.");}finally{setUpdating(false);}}
  async function addAsset(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!customer)return;
    const data=new FormData(event.currentTarget),productId=String(data.get("productId")||"").trim(),serialNumber=String(data.get("serialNumber")||"").trim(),installedAt=String(data.get("installedAt")||""),warrantyEndsAt=String(data.get("warrantyEndsAt")||""),maintenanceIntervalMonths=Number(data.get("maintenanceIntervalMonths")||6);
    if(productId.length<2||!installedAt||!Number.isInteger(maintenanceIntervalMonths)||maintenanceIntervalMonths<1||maintenanceIntervalMonths>120||(warrantyEndsAt&&warrantyEndsAt<installedAt)){setAssetError("تحقق من بيانات الجهاز وتواريخ التركيب والضمان.");return;}
    setUpdating(true);
    try{
      let asset:Asset={id:`preview-${Date.now()}`,product_id:productId,serial_number:serialNumber,installed_at:installedAt,warranty_ends_at:warrantyEndsAt||undefined,maintenance_interval_months:maintenanceIntervalMonths,next_maintenance_at:nextMaintenance(installedAt,maintenanceIntervalMonths),status:"active"};
      if(apiBase){const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/assets`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({productId,serialNumber,installedAt,warrantyEndsAt:warrantyEndsAt||undefined,maintenanceIntervalMonths})});const payload=await response.json();if(!response.ok)throw new Error(payload.error==="invalid_asset"?"بيانات الجهاز غير صحيحة.":"تعذر تسجيل الجهاز.");asset=payload.asset;}
      setCustomer({...customer,assets:[asset,...customer.assets]});setAssetError("");setAssetOpen(false);
    }catch(reason){setAssetError(reason instanceof Error?reason.message:"تعذر تسجيل الجهاز.");}
    finally{setUpdating(false);}
  }
  async function loadOrderPage(nextPage:number){
    if(!apiBase||!customer||nextPage<0)return;
    setOrderLoading(true);
    try{
      const token=sessionStorage.getItem("subil_session");
      const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/orders?limit=20&offset=${nextPage*20}`,{headers:{Authorization:`Bearer ${token}`}});
      const payload=await response.json();
      if(!response.ok)throw new Error("تعذر تحميل طلبات العميل.");
      setCustomer(current=>current?{...current,orders:payload.orders||[]}:current);
      setOrderTotal(Number(payload.pagination?.total||0));setOrderPage(nextPage);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"تعذر تحميل طلبات العميل.");}
    finally{setOrderLoading(false);}
  }
  const total=useMemo(()=>Number(customer?.order_total_ex_vat??customer?.orders.reduce((sum,order)=>sum+Number(order.total_ex_vat||0),0)??0),[customer]);
  const orderCount=Number(customer?.order_count??orderTotal);
  return <PreviewAuthGuard><main className="customers-page"><header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><div className="profile-avatar">م</div></header><div className="customers-wrap"><a className="back-link" href="/customers">→ العودة إلى العملاء</a>
    {loading&&<div className="detail-loading" role="status">جارٍ تحميل بيانات العميل...</div>}{error&&<div className="api-error" role="alert">{error}</div>}
    {customer&&!loading&&<><div className="customer-profile-head"><div className="customer-avatar">{customer.name.slice(0,1)}</div><div><p>{customer.id}</p><h1>{customer.name}</h1><span className="status done">عميل نشط</span></div><button className="secondary-button" onClick={()=>setEditOpen(true)}>تعديل البيانات</button></div><section className="customer-detail-grid">
      <article className="panel detail-card"><div className="detail-card-head"><h2>بيانات التواصل والعناوين</h2><button onClick={()=>{setEditError("");setAddressOpen(!addressOpen);}}>+ إضافة عنوان</button></div><dl><div><dt>رقم الجوال</dt><dd dir="ltr">{customer.mobile||"—"}</dd></div><div><dt>عميل منذ</dt><dd>{date(customer.created_at)}</dd></div>{customer.addresses.map((item,index)=><div key={item.id||index}><dt>العنوان {index+1}</dt><dd>{item.address_text||"—"}{item.city_id?`، ${item.city_id}`:""}</dd></div>)}</dl>{addressOpen&&<form className="address-inline-form" onSubmit={addAddress}><input name="cityId" defaultValue="الرياض" disabled={updating} aria-label="المدينة"/><input name="addressText" placeholder="الحي، الشارع، رقم المبنى" disabled={updating} aria-label="تفاصيل العنوان"/>{editError&&<p className="form-error">{editError}</p>}<div><button type="button" className="secondary-button" onClick={()=>setAddressOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating}>{updating?"جارٍ الحفظ...":"حفظ العنوان"}</button></div></form>}</article>
      <article className="panel detail-card"><h2>ملخص العميل</h2><div className="detail-metrics"><div><span>إجمالي الطلبات</span><strong>{orderCount.toLocaleString("ar-SA")}</strong></div><div><span>إجمالي القيمة</span><strong>{total.toLocaleString("ar-SA")} ر.س</strong></div></div></article>
      <article className="panel detail-card asset-card"><div className="detail-card-head"><h2>الأجهزة والأصول</h2><button onClick={()=>{setAssetError("");setAssetOpen(true);}}>+ تسجيل جهاز</button></div>{customer.assets.length?customer.assets.map((asset,index)=><div className="asset-record" key={asset.id||index}><div className="asset-row"><div><strong>{asset.product_id||"جهاز سبيل"}</strong><span>الرقم التسلسلي: {asset.serial_number||"—"}</span></div><span className={`status ${asset.status==="active"?"done":"scheduled"}`}>{asset.status==="active"?"نشط":"غير نشط"}</span></div><p>الضمان حتى {date(asset.warranty_ends_at)} · الصيانة القادمة {date(asset.next_maintenance_at)}</p></div>):<div className="inline-empty">لا توجد أجهزة مسجلة لهذا العميل.</div>}</article>
      <article className="panel detail-orders"><div className="panel-head"><div><h2>آخر الطلبات</h2><p>{orderLoading?"جارٍ التحميل...":"سجل خدمات العميل"}</p></div></div>{customer.orders.length?<><div className="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>{customer.orders.map((order,index)=><tr key={order.id||index}><td><strong className="order-id">#{order.external_order_id||order.id}</strong></td><td>{date(order.created_at)}</td><td>{Number(order.total_ex_vat||0).toLocaleString("ar-SA")} ر.س</td><td><span className={`status ${order.paid_at?"done":"working"}`}>{order.paid_at?"مدفوع":"قيد المعالجة"}</span></td></tr>)}</tbody></table></div>{apiBase&&orderTotal>20&&<nav className="customers-pagination" aria-label="صفحات طلبات العميل"><button className="secondary-button" disabled={orderLoading||orderPage===0} onClick={()=>loadOrderPage(orderPage-1)}>السابق</button><span>صفحة {(orderPage+1).toLocaleString("ar-SA")} من {Math.ceil(orderTotal/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={orderLoading||(orderPage+1)*20>=orderTotal} onClick={()=>loadOrderPage(orderPage+1)}>التالي</button></nav>}</>:<div className="inline-empty">لا توجد طلبات مسجلة لهذا العميل.</div>}</article>
      {apiBase&&<article className="panel detail-card timeline-card"><h2>سجل النشاط</h2>{timeline.length?<div className="timeline-list">{timeline.map(item=><div key={`${item.type}-${item.id}`}><i/><span>{item.type==="order"?"طلب":item.type==="job"?"مهمة خدمة":"إشعار"} · {item.reference||item.id}<small>{item.status||"—"} · {date(item.occurred_at)}</small></span></div>)}</div>:<div className="inline-empty">لا يوجد نشاط مسجل.</div>}</article>}
    </section></>}{editOpen&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setEditOpen(false);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-head"><div><h2 id="edit-title">تعديل بيانات العميل</h2><p>تحديث الاسم ورقم الجوال</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setEditOpen(false)}>×</button></div><form onSubmit={updateCustomer}><label>اسم العميل<input name="name" defaultValue={customer.name} disabled={updating} autoFocus /></label><label>رقم الجوال<input name="mobile" defaultValue={customer.mobile} disabled={updating} dir="ltr" inputMode="tel" /></label>{editError&&<p className="form-error" role="alert">{editError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setEditOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"حفظ التعديلات"}</button></div></form></section></div>}{assetOpen&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setAssetOpen(false);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title"><div className="modal-head"><div><h2 id="asset-title">تسجيل جهاز للعميل</h2><p>إضافة بيانات التركيب وخطة الصيانة</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setAssetOpen(false)}>×</button></div><form onSubmit={addAsset}><label>اسم الجهاز<input name="productId" autoFocus disabled={updating} placeholder="مثال: جهاز سبيل 7 مراحل" /></label><label>الرقم التسلسلي<input name="serialNumber" dir="ltr" disabled={updating} placeholder="SBL-0000" /></label><label>تاريخ التركيب<input name="installedAt" type="date" defaultValue={today} disabled={updating} /></label><label>نهاية الضمان<input name="warrantyEndsAt" type="date" disabled={updating} /></label><label>دورية الصيانة بالأشهر<input name="maintenanceIntervalMonths" type="number" min="1" max="120" defaultValue="6" disabled={updating} /></label>{assetError&&<p className="form-error" role="alert">{assetError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setAssetOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"تسجيل الجهاز"}</button></div></form></section></div>}</div></main></PreviewAuthGuard>;
}

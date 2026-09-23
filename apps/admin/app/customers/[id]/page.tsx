"use client";import Header from"../../components/Header";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PreviewAuthGuard from "../../preview-auth-guard";

const apiBase=process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/,"")||"";
type Address={id?:string;city_id?:string;address_text?:string};
type Asset={id?:string;product_id?:string;serial_number?:string;installed_at?:string;warranty_ends_at?:string;last_maintenance_at?:string;next_maintenance_at?:string;maintenance_interval_months?:number;status?:string};
type Order={id?:string;external_order_id?:string;created_at?:string;paid_at?:string;total_ex_vat?:string};
type ServiceJob={id:string;external_order_id?:string;technician_id?:string;city_id?:string;address_text?:string;status:string;scheduled_at?:string;completed_at?:string;created_at?:string;rating_score?:number;rating_comment?:string};
type Customer={id:string;name:string;mobile?:string;created_at?:string;order_count?:number;order_total_ex_vat?:string;addresses:Address[];assets:Asset[];orders:Order[]};
type TimelineEvent={id:string;type:"order"|"job"|"notification"|"maintenance";reference?:string;status?:string;occurred_at?:string};
type MaintenanceEvent={id:string;completed_at?:string;notes?:string;performed_by?:string};

const previews:Record<string,Customer>={
  "CUS-1048":{id:"CUS-1048",name:"محمد القحطاني",mobile:"055 482 1930",created_at:"2024-03-10",addresses:[{id:"a1",city_id:"الرياض",address_text:"حي الياسمين"}],assets:[{id:"as1",product_id:"جهاز سبيل ٧ مراحل",serial_number:"SBL-7-29418",warranty_ends_at:"2027-03-10",next_maintenance_at:"2026-12-15",status:"active"}],orders:[{id:"SB-1048",external_order_id:"1048",created_at:"2026-09-15",paid_at:"2026-09-15",total_ex_vat:"1450"},{id:"SB-0982",external_order_id:"982",created_at:"2026-06-12",paid_at:"2026-06-12",total_ex_vat:"620"}]},
  "CUS-1047":{id:"CUS-1047",name:"نورة الدوسري",mobile:"053 761 4280",created_at:"2024-11-05",addresses:[{id:"a2",city_id:"الرياض",address_text:"حي الملقا"}],assets:[],orders:[]},
  "CUS-1046":{id:"CUS-1046",name:"شركة روافد",mobile:"011 452 7300",created_at:"2023-01-20",addresses:[{id:"a3",city_id:"الرياض",address_text:"حي السليمانية"}],assets:[],orders:[]},
  "CUS-1045":{id:"CUS-1045",name:"سعد العتيبي",mobile:"050 339 8124",created_at:"2026-09-12",addresses:[{id:"a4",city_id:"الرياض",address_text:"حي قرطبة"}],assets:[],orders:[]},
};
const previewServiceJobs:Record<string,ServiceJob[]>={
  "CUS-1048":[{id:"JOB-1048",external_order_id:"1048",technician_id:"TECH-12",city_id:"الرياض",address_text:"حي الياسمين",status:"completed",scheduled_at:"2026-09-15",completed_at:"2026-09-15",rating_score:5,rating_comment:"خدمة ممتازة"}]
};
const formatter=new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium"});
const today=new Date().toISOString().slice(0,10);
function date(value?:string){return value?formatter.format(new Date(value)):"—";}
function nextMaintenance(value:string,months:number){const result=new Date(`${value}T00:00:00Z`),day=result.getUTCDate();result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()+months);const lastDay=new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();result.setUTCDate(Math.min(day,lastDay));return result.toISOString();}
function maintenanceOverdue(asset:Asset){return asset.status==="active"&&Boolean(asset.next_maintenance_at)&&new Date(asset.next_maintenance_at as string)<new Date();}
function jobStatus(value:string){return({pending_assignment:"بانتظار الإسناد",scheduled:"مجدولة",en_route:"في الطريق",arrived:"وصل الفني",in_progress:"قيد التنفيذ",completed:"مكتملة",cancelled:"ملغاة"} as Record<string,string>)[value]||value;}
function jobStatusClass(value:string){return value==="completed"?"done":value==="in_progress"||value==="arrived"?"working":value==="en_route"?"enroute":"scheduled";}

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
  const [maintenanceAsset,setMaintenanceAsset]=useState<Asset|null>(null);
  const [maintenanceError,setMaintenanceError]=useState("");
  const [historyAsset,setHistoryAsset]=useState<Asset|null>(null);
  const [maintenanceHistory,setMaintenanceHistory]=useState<MaintenanceEvent[]>([]);
  const [historyPage,setHistoryPage]=useState(0);
  const [historyTotal,setHistoryTotal]=useState(0);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState("");
  const [timeline,setTimeline]=useState<TimelineEvent[]>([]);
  const [timelinePage,setTimelinePage]=useState(0);
  const [timelineTotal,setTimelineTotal]=useState(0);
  const [timelineLoading,setTimelineLoading]=useState(false);
  const [orderPage,setOrderPage]=useState(0);
  const [orderTotal,setOrderTotal]=useState(apiBase?0:(previews[id]||previews["CUS-1048"]).orders.length);
  const [orderLoading,setOrderLoading]=useState(false);
  const [serviceJobs,setServiceJobs]=useState<ServiceJob[]>(apiBase?[]:(previewServiceJobs[id]||[]));
  const [jobPage,setJobPage]=useState(0);
  const [jobTotal,setJobTotal]=useState(apiBase?0:(previewServiceJobs[id]||[]).length);
  const [jobLoading,setJobLoading]=useState(false);
  useEffect(()=>{
    if(!apiBase)return;
    const controller=new AbortController(),token=sessionStorage.getItem("subil_session");
    const headers={Authorization:`Bearer ${token}`};
    const customerPath=`${apiBase}/api/v1/customers/${encodeURIComponent(id)}`;
    Promise.all([
      fetch(customerPath,{headers,signal:controller.signal}),
      fetch(`${customerPath}/timeline?limit=10`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/addresses?limit=100`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/assets?limit=100`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/orders?limit=20`,{headers,signal:controller.signal}),
      fetch(`${customerPath}/jobs?limit=10`,{headers,signal:controller.signal})
    ])
      .then(async([details,history,addresses,assets,orders,jobs])=>{
        if(!details.ok)throw new Error(details.status===404?"لم يتم العثور على العميل.":details.status===401?"انتهت جلسة الدخول. سجل الدخول مجددًا.":"تعذر تحميل بيانات العميل.");
        const [payload,timelinePayload,addressPayload,assetPayload,orderPayload,jobPayload]=await Promise.all([
          details.json(),history.ok?history.json():Promise.resolve({timeline:[]}),
          addresses.ok?addresses.json():Promise.resolve({addresses:null}),
          assets.ok?assets.json():Promise.resolve({assets:null}),
          orders.ok?orders.json():Promise.resolve({orders:[],pagination:{total:0}}),
          jobs.ok?jobs.json():Promise.resolve({jobs:[],pagination:{total:0}})
        ]);
        return{payload,timelinePayload,addressPayload,assetPayload,orderPayload,jobPayload};
      })
      .then(({payload,timelinePayload,addressPayload,assetPayload,orderPayload,jobPayload})=>{
        setCustomer({...payload.customer,addresses:addressPayload.addresses??[],assets:assetPayload.assets??[],orders:orderPayload.orders??[]});
        setTimeline(timelinePayload.timeline||[]);
        setTimelineTotal(Number(timelinePayload.pagination?.total||0));setTimelinePage(0);
        setOrderTotal(Number(orderPayload.pagination?.total||payload.customer.order_count||0));
        setOrderPage(0);
        setServiceJobs(jobPayload.jobs||[]);setJobTotal(Number(jobPayload.pagination?.total||0));setJobPage(0);
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
  async function completeAssetMaintenance(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!customer||!maintenanceAsset?.id)return;
    const data=new FormData(event.currentTarget),completedAt=String(data.get("completedAt")||""),notes=String(data.get("notes")||"").trim();
    if(!completedAt){setMaintenanceError("حدد تاريخ إتمام الصيانة.");return;}
    setUpdating(true);
    try{
      let updated:Asset={...maintenanceAsset,last_maintenance_at:new Date(`${completedAt}T00:00:00Z`).toISOString(),next_maintenance_at:nextMaintenance(completedAt,maintenanceAsset.maintenance_interval_months||6)};
      if(apiBase){const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/assets/${encodeURIComponent(maintenanceAsset.id)}/maintenance`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({completedAt,notes})});const payload=await response.json();if(!response.ok)throw new Error(payload.error==="asset_not_active"?"لا يمكن تسجيل صيانة لجهاز غير نشط.":"تعذر تسجيل الصيانة.");updated=payload.asset;}
      setCustomer({...customer,assets:customer.assets.map(asset=>asset.id===maintenanceAsset.id?updated:asset)});setMaintenanceError("");setMaintenanceAsset(null);
    }catch(reason){setMaintenanceError(reason instanceof Error?reason.message:"تعذر تسجيل الصيانة.");}
    finally{setUpdating(false);}
  }
  async function toggleAssetStatus(asset:Asset){
    if(!customer||!asset.id)return;
    const status=asset.status==="active"?"inactive":"active";setUpdating(true);
    try{
      let updated={...asset,status};
      if(apiBase){const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.id)}`,{method:"PATCH",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({status})});const payload=await response.json();if(!response.ok)throw new Error("تعذر تحديث حالة الجهاز.");updated=payload.asset;}
      setCustomer({...customer,assets:customer.assets.map(item=>item.id===asset.id?updated:item)});setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"تعذر تحديث حالة الجهاز.");}
    finally{setUpdating(false);}
  }
  async function loadMaintenanceHistory(asset:Asset,nextPage=0){
    if(!asset.id||nextPage<0)return;
    setHistoryAsset(asset);setHistoryLoading(true);setHistoryError("");
    if(!apiBase){const preview=asset.last_maintenance_at?[{id:"preview-maintenance",completed_at:asset.last_maintenance_at,notes:"صيانة دورية مكتملة"}]:[];setMaintenanceHistory(preview);setHistoryTotal(preview.length);setHistoryPage(0);setHistoryLoading(false);return;}
    try{
      const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.id)}/history?limit=10&offset=${nextPage*10}`,{headers:{Authorization:`Bearer ${token}`}});const payload=await response.json();if(!response.ok)throw new Error("تعذر تحميل سجل الصيانة.");setMaintenanceHistory(payload.maintenance||[]);setHistoryTotal(Number(payload.pagination?.total||0));setHistoryPage(nextPage);
    }catch(reason){setHistoryError(reason instanceof Error?reason.message:"تعذر تحميل سجل الصيانة.");}
    finally{setHistoryLoading(false);}
  }
  async function loadTimelinePage(nextPage:number){
    if(!apiBase||nextPage<0)return;setTimelineLoading(true);
    try{const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/timeline?limit=10&offset=${nextPage*10}`,{headers:{Authorization:`Bearer ${token}`}});const payload=await response.json();if(!response.ok)throw new Error("تعذر تحميل سجل النشاط.");setTimeline(payload.timeline||[]);setTimelineTotal(Number(payload.pagination?.total||0));setTimelinePage(nextPage);setError("");}
    catch(reason){setError(reason instanceof Error?reason.message:"تعذر تحميل سجل النشاط.");}
    finally{setTimelineLoading(false);}
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
  async function loadJobPage(nextPage:number){
    if(!apiBase||nextPage<0)return;setJobLoading(true);
    try{const token=sessionStorage.getItem("subil_session");const response=await fetch(`${apiBase}/api/v1/customers/${encodeURIComponent(id)}/jobs?limit=10&offset=${nextPage*10}`,{headers:{Authorization:`Bearer ${token}`}});const payload=await response.json();if(!response.ok)throw new Error("تعذر تحميل سجل الخدمات.");setServiceJobs(payload.jobs||[]);setJobTotal(Number(payload.pagination?.total||0));setJobPage(nextPage);setError("");}
    catch(reason){setError(reason instanceof Error?reason.message:"تعذر تحميل سجل الخدمات.");}
    finally{setJobLoading(false);}
  }
  const total=useMemo(()=>Number(customer?.order_total_ex_vat??customer?.orders.reduce((sum,order)=>sum+Number(order.total_ex_vat||0),0)??0),[customer]);
  const orderCount=Number(customer?.order_count??orderTotal);
  return <PreviewAuthGuard><main className="customers-page"><Header active="/customers"/><div className="customers-wrap"><a className="back-link" href="/customers">→ العودة إلى العملاء</a>
    {loading&&<div className="detail-loading" role="status">جارٍ تحميل بيانات العميل...</div>}{error&&<div className="api-error" role="alert">{error}</div>}
    {customer&&!loading&&<><div className="customer-profile-head"><div className="customer-avatar">{customer.name.slice(0,1)}</div><div><p>{customer.id}</p><h1>{customer.name}</h1><span className="status done">عميل نشط</span></div><button className="secondary-button" onClick={()=>setEditOpen(true)}>تعديل البيانات</button></div><section className="customer-detail-grid">
      <article className="panel detail-card"><div className="detail-card-head"><h2>بيانات التواصل والعناوين</h2><button onClick={()=>{setEditError("");setAddressOpen(!addressOpen);}}>+ إضافة عنوان</button></div><dl><div><dt>رقم الجوال</dt><dd dir="ltr">{customer.mobile||"—"}</dd></div><div><dt>عميل منذ</dt><dd>{date(customer.created_at)}</dd></div>{customer.addresses.map((item,index)=><div key={item.id||index}><dt>العنوان {index+1}</dt><dd>{item.address_text||"—"}{item.city_id?`، ${item.city_id}`:""}</dd></div>)}</dl>{addressOpen&&<form className="address-inline-form" onSubmit={addAddress}><input name="cityId" defaultValue="الرياض" disabled={updating} aria-label="المدينة"/><input name="addressText" placeholder="الحي، الشارع، رقم المبنى" disabled={updating} aria-label="تفاصيل العنوان"/>{editError&&<p className="form-error">{editError}</p>}<div><button type="button" className="secondary-button" onClick={()=>setAddressOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating}>{updating?"جارٍ الحفظ...":"حفظ العنوان"}</button></div></form>}</article>
      <article className="panel detail-card"><h2>ملخص العميل</h2><div className="detail-metrics"><div><span>إجمالي الطلبات</span><strong>{orderCount.toLocaleString("ar-SA")}</strong></div><div><span>إجمالي القيمة</span><strong>{total.toLocaleString("ar-SA")} ر.س</strong></div></div></article>
      <article className="panel detail-card asset-card"><div className="detail-card-head"><h2>الأجهزة والأصول</h2><button onClick={()=>{setAssetError("");setAssetOpen(true);}}>+ تسجيل جهاز</button></div>{customer.assets.length?customer.assets.map((asset,index)=><div className="asset-record" key={asset.id||index}><div className="asset-row"><div><strong>{asset.product_id||"جهاز سبيل"}</strong><span>الرقم التسلسلي: {asset.serial_number||"—"}</span></div><div className="asset-actions"><button className="asset-maintenance-button" disabled={updating||asset.status!=="active"} onClick={()=>{setMaintenanceError("");setMaintenanceAsset(asset);}}>تسجيل صيانة</button><button className="asset-history-button" disabled={updating} onClick={()=>loadMaintenanceHistory(asset)}>سجل الصيانة</button><button className="asset-status-button" disabled={updating||asset.status==="retired"} onClick={()=>toggleAssetStatus(asset)}>{asset.status==="active"?"إيقاف":"تفعيل"}</button></div><span className={`status ${maintenanceOverdue(asset)?"working":asset.status==="active"?"done":"scheduled"}`}>{maintenanceOverdue(asset)?"صيانة متأخرة":asset.status==="active"?"نشط":"غير نشط"}</span></div><p>آخر صيانة {date(asset.last_maintenance_at)} · الصيانة القادمة {date(asset.next_maintenance_at)} · الضمان حتى {date(asset.warranty_ends_at)}</p></div>):<div className="inline-empty">لا توجد أجهزة مسجلة لهذا العميل.</div>}</article>
      <article className="panel detail-orders service-history"><div className="panel-head"><div><h2>سجل الخدمات والزيارات</h2><p>{jobLoading?"جارٍ التحميل...":"التركيب والصيانة والمهام الميدانية"}</p></div></div>{serviceJobs.length?<><div className="table-wrap"><table><thead><tr><th>المهمة</th><th>الموعد</th><th>الموقع</th><th>الفني</th><th>الحالة</th><th>التقييم</th></tr></thead><tbody>{serviceJobs.map(job=><tr key={job.id}><td><strong className="order-id">#{job.external_order_id||job.id}</strong></td><td>{date(job.scheduled_at||job.created_at)}</td><td>{job.address_text||job.city_id||"—"}</td><td>{job.technician_id||"لم يُسند"}</td><td><span className={`status ${jobStatusClass(job.status)}`}>{jobStatus(job.status)}</span></td><td>{job.rating_score?<span className="service-rating" title={job.rating_comment||""}>★ {Number(job.rating_score).toLocaleString("ar-SA")}/٥</span>:"—"}</td></tr>)}</tbody></table></div>{apiBase&&jobTotal>10&&<nav className="customers-pagination" aria-label="صفحات سجل الخدمات"><button className="secondary-button" disabled={jobLoading||jobPage===0} onClick={()=>loadJobPage(jobPage-1)}>السابق</button><span>صفحة {(jobPage+1).toLocaleString("ar-SA")} من {Math.ceil(jobTotal/10).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={jobLoading||(jobPage+1)*10>=jobTotal} onClick={()=>loadJobPage(jobPage+1)}>التالي</button></nav>}</>:<div className="inline-empty">لا توجد زيارات أو خدمات مسجلة لهذا العميل.</div>}</article>
      <article className="panel detail-orders"><div className="panel-head"><div><h2>آخر الطلبات</h2><p>{orderLoading?"جارٍ التحميل...":"سجل خدمات العميل"}</p></div></div>{customer.orders.length?<><div className="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>{customer.orders.map((order,index)=><tr key={order.id||index}><td><strong className="order-id">#{order.external_order_id||order.id}</strong></td><td>{date(order.created_at)}</td><td>{Number(order.total_ex_vat||0).toLocaleString("ar-SA")} ر.س</td><td><span className={`status ${order.paid_at?"done":"working"}`}>{order.paid_at?"مدفوع":"قيد المعالجة"}</span></td></tr>)}</tbody></table></div>{apiBase&&orderTotal>20&&<nav className="customers-pagination" aria-label="صفحات طلبات العميل"><button className="secondary-button" disabled={orderLoading||orderPage===0} onClick={()=>loadOrderPage(orderPage-1)}>السابق</button><span>صفحة {(orderPage+1).toLocaleString("ar-SA")} من {Math.ceil(orderTotal/20).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={orderLoading||(orderPage+1)*20>=orderTotal} onClick={()=>loadOrderPage(orderPage+1)}>التالي</button></nav>}</>:<div className="inline-empty">لا توجد طلبات مسجلة لهذا العميل.</div>}</article>
      {apiBase&&<article className="panel detail-card timeline-card"><h2>سجل النشاط</h2>{timelineLoading?<div className="inline-empty">جارٍ تحميل النشاط...</div>:timeline.length?<><div className="timeline-list">{timeline.map(item=><div key={`${item.type}-${item.id}`}><i/><span>{item.type==="order"?"طلب":item.type==="job"?"مهمة خدمة":item.type==="maintenance"?"صيانة جهاز":"إشعار"} · {item.reference||item.id}<small>{item.status||"—"} · {date(item.occurred_at)}</small></span></div>)}</div>{timelineTotal>10&&<nav className="customers-pagination" aria-label="صفحات سجل النشاط"><button className="secondary-button" disabled={timelineLoading||timelinePage===0} onClick={()=>loadTimelinePage(timelinePage-1)}>السابق</button><span>صفحة {(timelinePage+1).toLocaleString("ar-SA")} من {Math.ceil(timelineTotal/10).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={timelineLoading||(timelinePage+1)*10>=timelineTotal} onClick={()=>loadTimelinePage(timelinePage+1)}>التالي</button></nav>}</>:<div className="inline-empty">لا يوجد نشاط مسجل.</div>}</article>}
    </section></>}{editOpen&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setEditOpen(false);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-head"><div><h2 id="edit-title">تعديل بيانات العميل</h2><p>تحديث الاسم ورقم الجوال</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setEditOpen(false)}>×</button></div><form onSubmit={updateCustomer}><label>اسم العميل<input name="name" defaultValue={customer.name} disabled={updating} autoFocus /></label><label>رقم الجوال<input name="mobile" defaultValue={customer.mobile} disabled={updating} dir="ltr" inputMode="tel" /></label>{editError&&<p className="form-error" role="alert">{editError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setEditOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"حفظ التعديلات"}</button></div></form></section></div>}{assetOpen&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setAssetOpen(false);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title"><div className="modal-head"><div><h2 id="asset-title">تسجيل جهاز للعميل</h2><p>إضافة بيانات التركيب وخطة الصيانة</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setAssetOpen(false)}>×</button></div><form onSubmit={addAsset}><label>اسم الجهاز<input name="productId" autoFocus disabled={updating} placeholder="مثال: جهاز سبيل 7 مراحل" /></label><label>الرقم التسلسلي<input name="serialNumber" dir="ltr" disabled={updating} placeholder="SBL-0000" /></label><label>تاريخ التركيب<input name="installedAt" type="date" defaultValue={today} disabled={updating} /></label><label>نهاية الضمان<input name="warrantyEndsAt" type="date" disabled={updating} /></label><label>دورية الصيانة بالأشهر<input name="maintenanceIntervalMonths" type="number" min="1" max="120" defaultValue="6" disabled={updating} /></label>{assetError&&<p className="form-error" role="alert">{assetError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setAssetOpen(false)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"تسجيل الجهاز"}</button></div></form></section></div>}{maintenanceAsset&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!updating)setMaintenanceAsset(null);}}><section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="maintenance-title"><div className="modal-head"><div><h2 id="maintenance-title">تسجيل صيانة مكتملة</h2><p>{maintenanceAsset.product_id} · {maintenanceAsset.serial_number||"بدون رقم تسلسلي"}</p></div><button aria-label="إغلاق" disabled={updating} onClick={()=>setMaintenanceAsset(null)}>×</button></div><form onSubmit={completeAssetMaintenance}><label>تاريخ إتمام الصيانة<input name="completedAt" type="date" defaultValue={today} disabled={updating} /></label><label>ملاحظات الصيانة<input name="notes" disabled={updating} placeholder="مثال: تغيير الشمعات وفحص المضخة" /></label>{maintenanceError&&<p className="form-error" role="alert">{maintenanceError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={updating} onClick={()=>setMaintenanceAsset(null)}>إلغاء</button><button className="primary-button" disabled={updating} type="submit">{updating?"جارٍ الحفظ...":"حفظ الصيانة"}</button></div></form></section></div>}{historyAsset&&customer&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!historyLoading)setHistoryAsset(null);}}><section className="customer-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"><div className="modal-head"><div><h2 id="history-title">سجل صيانة الجهاز</h2><p>{historyAsset.product_id} · {historyAsset.serial_number||"بدون رقم تسلسلي"}</p></div><button aria-label="إغلاق" disabled={historyLoading} onClick={()=>setHistoryAsset(null)}>×</button></div>{historyError&&<p className="history-error" role="alert">{historyError}</p>}{historyLoading?<div className="inline-empty">جارٍ تحميل السجل...</div>:maintenanceHistory.length?<div className="maintenance-history-list">{maintenanceHistory.map(item=><article key={item.id}><strong>{date(item.completed_at)}</strong><span>{item.notes||"صيانة دورية مكتملة"}</span></article>)}</div>:<div className="inline-empty">لا توجد عمليات صيانة مسجلة لهذا الجهاز.</div>}{historyTotal>10&&<nav className="customers-pagination" aria-label="صفحات سجل الصيانة"><button className="secondary-button" disabled={historyLoading||historyPage===0} onClick={()=>loadMaintenanceHistory(historyAsset,historyPage-1)}>السابق</button><span>صفحة {(historyPage+1).toLocaleString("ar-SA")} من {Math.ceil(historyTotal/10).toLocaleString("ar-SA")}</span><button className="secondary-button" disabled={historyLoading||(historyPage+1)*10>=historyTotal} onClick={()=>loadMaintenanceHistory(historyAsset,historyPage+1)}>التالي</button></nav>}</section></div>}</div></main></PreviewAuthGuard>;
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import PreviewAuthGuard from "../../preview-auth-guard";

const apiBase = process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/, "") || "";
type Metric = { name: string; medium?: string; source?: string; orders: number; revenue: number | string; spend: number | string; roas?: number | string };
type Recent = { id: string; external_order_id: string; customer_name: string; total_ex_vat: number | string; first_source?: string; first_campaign?: string; last_source?: string; last_campaign?: string };
type Data = { summary: { paid_orders: number; attributed_revenue: number | string; spend: number | string; visitors: number; roas?: number | null; attribution_rate: number }; channels: Metric[]; campaigns: Metric[]; recent: Recent[] };
const seed: Data = {
  summary: { paid_orders: 148, attributed_revenue: 103800, spend: 18400, visitors: 3240, roas: 5.64, attribution_rate: 80.4 },
  channels: [{ name: "google", medium: "cpc", orders: 52, revenue: 48600, spend: 8400, roas: 5.79 }, { name: "instagram", medium: "paid_social", orders: 41, revenue: 35200, spend: 7200, roas: 4.89 }, { name: "direct", medium: "none", orders: 26, revenue: 20000, spend: 0 }],
  campaigns: [{ name: "أجهزة التحلية - سبتمبر", source: "google", orders: 34, revenue: 31800, spend: 5200 }, { name: "صيانة دورية", source: "instagram", orders: 22, revenue: 15400, spend: 2800 }],
  recent: [{ id: "o1", external_order_id: "1048", customer_name: "محمد القحطاني", total_ex_vat: 650, first_source: "google", first_campaign: "أجهزة التحلية", last_source: "instagram", last_campaign: "إعادة الاستهداف" }],
};
const money = (value: number | string) => Number(value || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AttributionPage() {
  const [data, setData] = useState<Data>(seed);
  const [period, setPeriod] = useState("30");
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(!apiBase);

  useEffect(() => setCanManage(!apiBase || ["branch_manager", "admin", "super_admin"].includes(sessionStorage.getItem("subil_role") || "")), []);
  useEffect(() => {
    if (!apiBase) return;
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 86400000);
    fetch(`${apiBase}/api/v1/marketing/attribution?from=${from.toISOString()}&to=${to.toISOString()}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("subil_session")}` } })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error("تعذر تحميل الإسناد التسويقي."); return body; })
      .then((body) => { setData(body); setError(""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "تعذر التحميل."));
  }, [period]);

  async function saveSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { source: String(form.get("source") || ""), campaign: String(form.get("campaign") || ""), amount: Number(form.get("amount")), spentOn: String(form.get("spentOn") || ""), currency: "SAR" };
    setSaving(true);
    try {
      if (apiBase) {
        const response = await fetch(`${apiBase}/api/v1/marketing/spend`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("subil_session")}` }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("تعذر تسجيل الإنفاق.");
      }
      setModal(false);
      setPeriod((value) => value === "30" ? "31" : "30");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر الحفظ."); }
    finally { setSaving(false); }
  }

  const summary = data.summary;
  const cards = [
    ["الزوار", Number(summary.visitors || 0).toLocaleString("ar-SA")],
    ["الطلبات المدفوعة", Number(summary.paid_orders || 0).toLocaleString("ar-SA")],
    ["نسبة الإسناد", `${Number(summary.attribution_rate || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%`],
    ["الإيراد المنسوب", `${money(summary.attributed_revenue)} ر.س`],
    ["الإنفاق", `${money(summary.spend)} ر.س`],
    ["العائد ROAS", summary.roas ? `${Number(summary.roas).toLocaleString("ar-SA", { maximumFractionDigits: 2 })}×` : "—"],
  ];

  return <PreviewAuthGuard><main className="customers-page attribution-page"><header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><nav className="section-nav"><a href="/">لوحة التحكم</a><a href="/marketing">الحملات</a><a href="/marketing/content">المحتوى</a><a className="active" href="/marketing/attribution">الإسناد والعائد</a><a href="/reports">التقارير</a></nav><div className="profile-avatar">م</div></header><div className="customers-wrap">
    <div className="demo-notice"><span>نسخة المعاينة</span> الإسناد يعتمد أول وآخر نقطة اتصال خلال 30 يومًا قبل الطلب.</div>
    <div className="page-head"><div><p>قياس التسويق والمبيعات</p><h1>الإسناد والعائد التسويقي</h1><span>اعرف القناة والحملة التي بدأت وأغلقت كل عملية بيع</span></div><div className="purchasing-head-actions"><select className="report-period" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">7 أيام</option><option value="30">30 يومًا</option><option value="90">90 يومًا</option></select>{canManage && <button className="primary-button" onClick={() => setModal(true)}>تسجيل إنفاق</button>}</div></div>
    <section className="marketing-stats attribution-stats">{cards.map(([title, value]) => <article key={title}><span>{title}</span><strong>{value}</strong></article>)}</section>
    {error && <div className="api-error">{error}</div>}
    <section className="attribution-grid"><article className="panel"><div className="panel-head"><div><h2>أداء القنوات</h2><p>الإيراد والإنفاق والعائد</p></div></div><div className="table-wrap"><table><thead><tr><th>القناة</th><th>الطلبات</th><th>الإيراد</th><th>الإنفاق</th><th>ROAS</th></tr></thead><tbody>{data.channels.map((item) => <tr key={item.name + "-" + (item.medium || "")}><td><strong>{item.name}</strong><small>{item.medium}</small></td><td>{Number(item.orders).toLocaleString("ar-SA")}</td><td>{money(item.revenue)} ر.س</td><td>{money(item.spend)} ر.س</td><td><strong className="positive">{item.roas ? `${Number(item.roas).toFixed(2)}×` : "عضوي"}</strong></td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-head"><div><h2>أفضل الحملات</h2><p>حسب الإيراد المنسوب</p></div></div>{data.campaigns.map((item) => <div className="breakdown-row" key={item.name + "-" + (item.source || "")}><div><strong>{item.name}</strong><small>{item.source} · {item.orders} طلب</small></div><div><strong>{money(item.revenue)} ر.س</strong><small>إنفاق {money(item.spend)}</small></div></div>)}</article></section>
    <section className="panel attribution-orders"><div className="panel-head"><div><h2>مسارات التحويل الأخيرة</h2><p>أول وآخر نقطة اتصال للطلب</p></div></div><div className="table-wrap"><table><thead><tr><th>الطلب والعميل</th><th>أول اتصال</th><th>آخر اتصال</th><th>الإيراد</th></tr></thead><tbody>{data.recent.map((item) => <tr key={item.id}><td><strong>#{item.external_order_id} · {item.customer_name}</strong></td><td><strong>{item.first_source || "مباشر"}</strong><small>{item.first_campaign || "—"}</small></td><td><strong>{item.last_source || "مباشر"}</strong><small>{item.last_campaign || "—"}</small></td><td><strong>{money(item.total_ex_vat)} ر.س</strong></td></tr>)}</tbody></table></div></section>
    {modal && <div className="modal-backdrop"><section className="customer-modal"><div className="modal-head"><div><h2>تسجيل إنفاق تسويقي</h2><p>لإظهار العائد الحقيقي للحملة</p></div><button onClick={() => setModal(false)}>×</button></div><form onSubmit={saveSpend}><label>المصدر<input name="source" required placeholder="google أو instagram" /></label><label>اسم الحملة<input name="campaign" /></label><label>المبلغ<input name="amount" required type="number" min="0" step="0.01" /></label><label>التاريخ<input name="spentOn" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>إلغاء</button><button className="primary-button" disabled={saving}>حفظ</button></div></form></section></div>}
  </div></main></PreviewAuthGuard>;
}

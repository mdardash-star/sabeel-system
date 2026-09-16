"use client";

import { useEffect, useState } from "react";
import PreviewAuthGuard from "../preview-auth-guard";

const apiBase = process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/, "") || "";

type Check = { label: string; status: "checking" | "ok" | "warn" | "error"; detail: string };

export default function SystemStatusPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [lastChecked, setLastChecked] = useState<string>("");

  async function runChecks() {
    const next: Check[] = [
      { label: "لوحة الإدارة", status: "ok", detail: "الواجهة تعمل" },
      { label: "API Health", status: "checking", detail: "جارٍ الفحص" },
      { label: "قاعدة البيانات", status: "checking", detail: "جارٍ الفحص" }
    ];
    setChecks(next);

    if (!apiBase) {
      setChecks([
        next[0],
        { label: "API Health", status: "error", detail: "NEXT_PUBLIC_SUBIL_API_URL غير مضبوط" },
        { label: "قاعدة البيانات", status: "error", detail: "تعذر فحص قاعدة البيانات بدون API" }
      ]);
      setLastChecked(new Date().toLocaleString("ar-SA"));
      return;
    }

    const health = await safeFetch(`${apiBase}/health`);
    const ready = await safeFetch(`${apiBase}/ready`);

    setChecks([
      next[0],
      health.ok
        ? { label: "API Health", status: "ok", detail: "الخدمة الخلفية تعمل" }
        : { label: "API Health", status: "error", detail: `تعذر الاتصال (${health.status || "network"})` },
      ready.ok
        ? { label: "قاعدة البيانات", status: "ok", detail: "PostgreSQL جاهزة" }
        : ready.status === 503
          ? { label: "قاعدة البيانات", status: "warn", detail: "الخدمة تعمل لكن قاعدة البيانات غير جاهزة" }
          : { label: "قاعدة البيانات", status: "error", detail: `فشل الفحص (${ready.status || "network"})` }
    ]);
    setLastChecked(new Date().toLocaleString("ar-SA"));
  }

  useEffect(() => { runChecks(); }, []);

  return (
    <PreviewAuthGuard>
      <main dir="rtl" style={{ minHeight: "100vh", background: "#f6f8fb", padding: "32px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div>
              <p style={{ margin: 0, color: "#6b7280" }}>تشغيل النظام</p>
              <h1 style={{ margin: "6px 0" }}>حالة نظام سبيل</h1>
              <p style={{ margin: 0, color: "#6b7280" }}>فحص مباشر للواجهة والـAPI وقاعدة البيانات</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <a href="/" style={{ padding: "10px 14px", borderRadius: 10, background: "white", textDecoration: "none", color: "#111827", border: "1px solid #e5e7eb" }}>لوحة التحكم</a>
              <button onClick={runChecks} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#075A9C", color: "white", cursor: "pointer" }}>إعادة الفحص</button>
            </div>
          </div>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            {checks.map(item => (
              <article key={item.label} style={{ background: "white", borderRadius: 16, padding: 20, border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <strong>{item.label}</strong>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: statusColor(item.status), display: "inline-block" }} />
                </div>
                <p style={{ marginBottom: 0, color: "#6b7280" }}>{item.detail}</p>
              </article>
            ))}
          </section>

          <section style={{ marginTop: 18, background: "white", borderRadius: 16, padding: 20, border: "1px solid #e5e7eb" }}>
            <strong>عنوان الـAPI</strong>
            <p dir="ltr" style={{ overflowWrap: "anywhere", color: "#4b5563" }}>{apiBase || "غير مضبوط"}</p>
            <small style={{ color: "#6b7280" }}>آخر فحص: {lastChecked || "جارٍ الفحص"}</small>
          </section>
        </div>
      </main>
    </PreviewAuthGuard>
  );
}

async function safeFetch(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function statusColor(status: Check["status"]) {
  if (status === "ok") return "#20A957";
  if (status === "warn") return "#f59e0b";
  if (status === "error") return "#dc2626";
  return "#94a3b8";
}

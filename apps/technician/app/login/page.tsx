"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/, "") || "";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (sessionStorage.getItem("subil_technician_session")) router.replace("/"); }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!/^5\d{8}$/.test(mobile)) return setError("أدخل رقم جوال سعودي صحيحًا");
    if (step === "otp" && !/^\d{6}$/.test(otp)) return setError("أدخل رمز التحقق المكوّن من 6 أرقام");
    if (!apiBase) {
      if (step === "mobile") return setStep("otp");
      sessionStorage.setItem("subil_technician_session", "preview-technician-session"); router.replace("/"); return;
    }
    setLoading(true);
    try {
      const path = step === "mobile" ? "/api/v1/auth/otp/request" : "/api/v1/auth/otp/verify";
      const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobile: `+966${mobile}`, ...(step === "otp" ? { code: otp } : {}) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error("تعذر التحقق، حاول مرة أخرى");
      if (step === "mobile") setStep("otp");
      else {
        if (payload.user?.role !== "technician") throw new Error("هذا الرقم غير مرتبط بحساب فني");
        sessionStorage.setItem("subil_technician_session", payload.token); router.replace("/");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل الدخول"); }
    finally { setLoading(false); }
  }

  return <main className="login"><section className="login-card">
    <div className="logo"><span>S</span><div><strong>سبيل</strong><small>بوابة الفني</small></div></div>
    <div className="login-intro"><b>{step === "mobile" ? "مرحبًا بك" : "رمز التحقق"}</b><p>{step === "mobile" ? "أدخل رقم الجوال المسجل في حسابك" : `أرسلنا الرمز إلى +966 ${mobile}`}</p></div>
    <form onSubmit={submit}>
      {step === "mobile" ? <label>رقم الجوال<div className="phone" dir="ltr"><span>+966</span><input inputMode="numeric" autoComplete="tel-national" value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ""))} maxLength={9} autoFocus placeholder="5X XXX XXXX" /></div></label> : <label>رمز التحقق<input className="otp" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} maxLength={6} autoFocus placeholder="••••••" /></label>}
      {error && <p className="error">{error}</p>}
      <button disabled={loading}>{loading ? "جارٍ التحقق..." : step === "mobile" ? "إرسال رمز التحقق" : "دخول"}</button>
      {step === "otp" && <button type="button" className="link" onClick={() => { setStep("mobile"); setOtp(""); }}>تغيير رقم الجوال</button>}
    </form><footer>دخول آمن برمز تحقق · لا تتم مشاركة بيانات العميل</footer>
  </section></main>;
}

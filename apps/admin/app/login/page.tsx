"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_SUBIL_API_URL?.replace(/\/$/, "") || "";
const adminRoles = new Set(["dispatcher", "support", "finance", "branch_manager", "admin", "super_admin"]);

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 18h4" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^5\d{8}$/.test(mobile)) {
      setError("أدخل رقم جوال سعودي صحيحًا يبدأ بالرقم 5");
      return;
    }
    setError("");
    if (!apiBase) {
      setStep("otp");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/otp/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile: `+966${mobile}` }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(authErrorMessage(payload.error));
      setStep("otp");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذر إرسال رمز التحقق");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError("أدخل رمز التحقق المكوّن من 6 أرقام");
      return;
    }
    setError("");
    if (!apiBase) {
      router.push("/");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile: `+966${mobile}`, code: otp }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(authErrorMessage(payload.error));
      if (!adminRoles.has(payload.user?.role)) {
        throw new Error("لا توجد صلاحية لهذا الرقم للدخول إلى لوحة الإدارة");
      }
      sessionStorage.setItem("subil_session", payload.token);
      sessionStorage.setItem("subil_role", payload.user.role);
      router.push("/");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "تعذر التحقق من الرمز");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="منصة سبيل التشغيلية">
        <div className="login-orb orb-one" />
        <div className="login-orb orb-two" />
        <div className="login-visual-content">
          <div className="login-brand login-brand-light">
            <div className="brand-mark"><span>S</span></div>
            <div><strong>سبيل</strong><small>نظام التشغيل</small></div>
          </div>
          <div className="login-message">
            <span className="login-kicker">SUBIL OS</span>
            <h1>كل عمليات سبيل<br />في مكان واحد</h1>
            <p>إدارة الطلبات والعملاء والفنيين والخدمات الميدانية بكفاءة ووضوح.</p>
          </div>
          <div className="login-trust"><ShieldIcon /><span>دخول آمن ومحمي برمز تحقق</span></div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-mobile-brand">
            <div className="brand-mark"><span>S</span></div>
            <div><strong>سبيل</strong><small>نظام التشغيل</small></div>
          </div>

          {step === "mobile" ? (
            <>
              <div className="login-heading">
                <span className="login-icon"><PhoneIcon /></span>
                <h2>تسجيل الدخول</h2>
                <p>أدخل رقم جوالك لإرسال رمز التحقق</p>
              </div>
              <form className="login-form" onSubmit={requestOtp} noValidate>
                <label htmlFor="mobile">رقم الجوال</label>
                <div className={`phone-field${error ? " has-error" : ""}`} dir="ltr">
                  <span>+966</span>
                  <input
                    id="mobile"
                    name="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="5X XXX XXXX"
                    maxLength={9}
                    value={mobile}
                    onChange={(event) => setMobile(event.target.value.replace(/\D/g, ""))}
                    autoFocus
                  />
                </div>
                {error && <p className="field-error" role="alert">{error}</p>}
                <button className="login-submit" type="submit" disabled={loading}>{loading ? "جارٍ الإرسال..." : "إرسال رمز التحقق"}</button>
              </form>
            </>
          ) : (
            <>
              <div className="login-heading">
                <span className="login-icon"><ShieldIcon /></span>
                <h2>أدخل رمز التحقق</h2>
                <p>أرسلنا رمزًا من 6 أرقام إلى <b dir="ltr">+966 {mobile}</b></p>
              </div>
              <form className="login-form" onSubmit={verifyOtp} noValidate>
                <label htmlFor="otp">رمز التحقق</label>
                <input
                  className={`otp-field${error ? " has-error" : ""}`}
                  id="otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                  autoFocus
                  dir="ltr"
                />
                {error && <p className="field-error" role="alert">{error}</p>}
                <button className="login-submit" type="submit" disabled={loading}>{loading ? "جارٍ التحقق..." : "تحقق ودخول"}</button>
                <button className="login-back" type="button" onClick={() => { setStep("mobile"); setOtp(""); setError(""); }}>تغيير رقم الجوال</button>
              </form>
            </>
          )}

          {!apiBase && <div className="preview-login-note"><span>نسخة معاينة</span> لن تُرسل رسالة فعلية حاليًا؛ أدخل أي رمز من 6 أرقام.</div>}
          <button className="fallback-login" type="button">الدخول الإداري الاحتياطي</button>
          <p className="login-footer">© 2026 مؤسسة سبيل المتحدة للتجارة</p>
        </div>
      </section>
    </main>
  );
}

function authErrorMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_mobile: "رقم الجوال غير صحيح",
    otp_resend_cooldown: "انتظر دقيقة قبل طلب رمز جديد",
    otp_invalid_or_expired: "رمز التحقق غير صحيح أو انتهت صلاحيته",
    otp_attempts_exceeded: "تجاوزت عدد المحاولات؛ اطلب رمزًا جديدًا",
    user_inactive: "الحساب موقوف؛ تواصل مع الإدارة",
    otp_delivery_failed: "تعذر إرسال الرمز حاليًا؛ حاول لاحقًا",
    otp_sender_unavailable: "خدمة الرسائل غير مهيأة حاليًا",
  };
  return messages[code] || "تعذر إكمال تسجيل الدخول؛ حاول لاحقًا";
}

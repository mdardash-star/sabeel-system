"use client";

import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";

function requiresDirectNavigation(url:string){
  const value=url.toLowerCase();
  return value.includes("tap.company")||value.includes("tap-payments")||value.includes("amwal")||value.includes("amwalpay");
}

export default function PaymentPage(){
  const router=useRouter();
  const [url,setUrl]=useState("");
  const [error,setError]=useState("");

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const response=await fetch("/api/payment-target",{cache:"no-store"});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload?.error||"payment_target_missing");
        const parsed=new URL(String(payload?.url||""));
        if(parsed.protocol!=="https:")throw new Error("invalid_payment_url");
        const target=parsed.toString();
        if(payload?.mode==="direct"||requiresDirectNavigation(target)){
          window.location.replace(target);
          return;
        }
        if(active)setUrl(target);
      }catch{
        if(active)setError("تعذر تجهيز صفحة الدفع. ارجع إلى السلة وحاول مرة أخرى.");
      }
    })();
    return()=>{active=false};
  },[]);

  async function closePayment(){
    await fetch("/api/payment-target",{method:"DELETE"}).catch(()=>{});
    router.replace("/store");
  }

  return <main style={s.page} dir="rtl">
    <section style={s.shell}>
      <header style={s.header}>
        <button style={s.back} onClick={closePayment}>رجوع</button>
        <div>
          <small style={s.kicker}>سبيل</small>
          <h1 style={s.title}>الدفع الآمن</h1>
          <p style={s.note}>أكمل الدفع عبر بوابة الدفع الرسمية.</p>
        </div>
      </header>
      {error?<div style={s.error}>{error}</div>:url?<iframe title="الدفع الآمن" src={url} style={s.frame} allow="payment *; clipboard-read; clipboard-write" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"/>:<div style={s.loading}>جاري تجهيز صفحة الدفع</div>}
    </section>
  </main>
}

const s:Record<string,React.CSSProperties>={
  page:{minHeight:"100vh",background:"#f4f7f6",padding:10,fontFamily:"inherit"},
  shell:{maxWidth:760,margin:"0 auto",background:"#fff",borderRadius:20,overflow:"hidden",boxShadow:"0 14px 40px rgba(0,0,0,.06)"},
  header:{display:"flex",gap:12,alignItems:"flex-start",padding:16,borderBottom:"1px solid #edf0ee"},
  back:{border:"1px solid #dfe5e2",background:"#fff",borderRadius:10,padding:"9px 12px",fontWeight:800},
  kicker:{color:"#20a957",fontWeight:800},
  title:{margin:"2px 0 4px",fontSize:22},
  note:{margin:0,color:"#6b7280",fontSize:13},
  frame:{display:"block",width:"100%",height:"calc(100vh - 130px)",minHeight:620,border:0,background:"#fff"},
  error:{margin:16,padding:14,borderRadius:12,background:"#fff2f2",color:"#b42318",fontWeight:700},
  loading:{padding:40,textAlign:"center",color:"#6b7280",fontWeight:700}
};

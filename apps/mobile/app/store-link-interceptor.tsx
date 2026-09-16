"use client";

import {useEffect} from "react";
import {useRouter,usePathname} from "next/navigation";

const demoMode=process.env.NEXT_PUBLIC_SUBIL_DEMO_MODE==="true";

export default function StoreLinkInterceptor(){
  const router=useRouter();
  const pathname=usePathname();
  useEffect(()=>{
    if(!demoMode)return;
    const click=(event:MouseEvent)=>{
      const target=event.target as Element|null;
      const anchor=target?.closest?.('a[href^="https://subil.store"]') as HTMLAnchorElement|null;
      if(!anchor)return;
      if(anchor.href.includes('/contact'))return;
      event.preventDefault();
      event.stopPropagation();
      const label=(anchor.textContent||"").trim();
      router.push(label.includes("طلب جديد")?'/new-order':'/store');
    };
    document.addEventListener('click',click,true);
    return()=>document.removeEventListener('click',click,true);
  },[router]);
  if(!demoMode||pathname==='/login'||pathname==='/store')return null;
  return <button onClick={()=>router.push('/store')} style={{position:'fixed',left:14,bottom:86,zIndex:50,border:0,borderRadius:999,padding:'11px 15px',background:'#075A9C',color:'#fff',fontWeight:900,boxShadow:'0 10px 24px rgba(0,0,0,.18)'}}>🛒 المتجر</button>;
}

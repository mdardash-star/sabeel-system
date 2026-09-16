"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";

const demoMode=process.env.NEXT_PUBLIC_SUBIL_DEMO_MODE==="true";

export default function StoreLinkInterceptor(){
  const router=useRouter();
  useEffect(()=>{
    if(!demoMode)return;
    const click=(event:MouseEvent)=>{
      const target=event.target as Element|null;
      const anchor=target?.closest?.('a[href^="https://subil.store"]') as HTMLAnchorElement|null;
      if(!anchor)return;
      if(anchor.href.includes('/contact'))return;
      event.preventDefault();
      event.stopPropagation();
      router.push('/new-order');
    };
    document.addEventListener('click',click,true);
    return()=>document.removeEventListener('click',click,true);
  },[router]);
  return null;
}

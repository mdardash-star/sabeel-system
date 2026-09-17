"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";
import {nativePaymentsAvailable} from "./payments/native-payment-bridge";

export default function NativeCheckoutInterceptor(){
 const router=useRouter();
 useEffect(()=>{
   const onClick=(event:MouseEvent)=>{
     if(!nativePaymentsAvailable())return;
     const target=event.target instanceof Element?event.target.closest("button"):null;
     if(!target)return;
     const text=(target.textContent||"").trim();
     if(text.includes("الدفع وتأكيد الطلب")||text.includes("الدفع الآن")){
       event.preventDefault();
       event.stopPropagation();
       router.push("/native-checkout");
     }
   };
   document.addEventListener("click",onClick,true);
   return()=>document.removeEventListener("click",onClick,true);
 },[router]);
 return null;
}

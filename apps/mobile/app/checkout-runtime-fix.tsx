"use client";

import {useEffect} from "react";

export default function CheckoutRuntimeFix(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      try{
        const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
        if((url.includes("/api/store/cart/update-customer")||url.includes("/api/store/checkout"))&&init?.body&&typeof init.body==="string"){
          const body=JSON.parse(init.body);
          const billing=body.billing_address||{};
          const shipping=body.shipping_address||{};
          const postcode=shipping.postcode||billing.postcode||"00000";
          const phone=shipping.phone||billing.phone||"";
          body.billing_address={...billing,postcode:billing.postcode||postcode};
          body.shipping_address={...shipping,postcode,phone};
          init={...init,body:JSON.stringify(body)};
        }
      }catch{}
      return originalFetch(input,init);
    };

    const translate=()=>{
      document.querySelectorAll("label span,button,small,p,b,strong").forEach(el=>{
        const text=(el.textContent||"").trim();
        if(/^amwal$/i.test(text)||/^amwal pay$/i.test(text))el.textContent="أموال";
        if(/^stc pay$/i.test(text))el.textContent="إس تي سي باي";
      });
    };
    translate();
    const observer=new MutationObserver(translate);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{window.fetch=originalFetch;observer.disconnect()};
  },[]);
  return null;
}

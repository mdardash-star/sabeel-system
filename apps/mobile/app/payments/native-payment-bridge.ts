export type NativePaymentRequest={
 provider:string;
 orderId:string;
 orderKey?:string;
 checkoutUrl:string;
};

export type NativePaymentResult={
 status:"returned"|"cancelled"|"failed";
 message?:string;
};

declare global{
 interface Window{
   SubilNativePayments?:{
     start:(request:NativePaymentRequest)=>Promise<NativePaymentResult>;
     isAvailable?:()=>boolean;
   };
 }
}

export function nativePaymentsAvailable(){
 return typeof window!=="undefined"&&Boolean(window.SubilNativePayments?.start)&&(window.SubilNativePayments?.isAvailable?.()??true);
}

export async function startNativePayment(request:NativePaymentRequest):Promise<NativePaymentResult>{
 if(typeof window==="undefined"||!window.SubilNativePayments?.start){
   throw new Error("native_payment_bridge_unavailable");
 }
 return window.SubilNativePayments.start(request);
}

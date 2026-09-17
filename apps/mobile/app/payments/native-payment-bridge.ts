export type NativePaymentProvider="tap"|"amwal"|"tabby"|"tamara"|"apple_pay"|"mada"|"cards"|"stc_pay";

export type NativePaymentRequest={
 provider:NativePaymentProvider;
 orderId:string;
 amount:number;
 currency:"SAR";
 customer?:{name?:string;email?:string;phone?:string};
};

export type NativePaymentResult={
 status:"paid"|"cancelled"|"failed"|"pending";
 transactionId?:string;
 providerReference?:string;
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

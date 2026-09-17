import {syncWooOrderPayment} from "../../woo-runtime";

type PaymentEvent={provider:string;providerReference:string;orderId:string;status:"paid"|"pending"|"failed"|"cancelled";rawStatus:string;receivedAt:string};

export async function syncVerifiedPaymentEvent(event:PaymentEvent){
 if(!event.orderId)return {synced:false,reason:"missing_order_id"};
 const result=await syncWooOrderPayment(event);
 return {synced:!result?.skipped,result};
}

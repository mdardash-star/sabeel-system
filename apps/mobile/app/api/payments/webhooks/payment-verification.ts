import crypto from "node:crypto";

type AnyRecord=Record<string,any>;

function safeEqual(a:string,b:string){
 const ab=Buffer.from(a);const bb=Buffer.from(b);
 return ab.length===bb.length&&crypto.timingSafeEqual(ab,bb);
}

function pem(value:string){return value.replace(/\\n/g,"\n").trim()}

export function verifyAmwal(rawBody:string,headers:Headers){
 const signature=headers.get("x-signature")||"";
 const publicKey=String(process.env.AMWAL_WEBHOOK_PUBLIC_KEY||"").trim();
 if(!signature||!publicKey)return false;
 try{
   return crypto.verify("sha256",Buffer.from(rawBody),{key:pem(publicKey),padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(signature,"base64"));
 }catch{return false}
}

function sarAmount(value:unknown){const n=Number(value);return Number.isFinite(n)?n.toFixed(2):"0.00"}

export function verifyTap(payload:AnyRecord,headers:Headers){
 const posted=headers.get("hashstring")||"";
 const secret=String(process.env.TAP_SECRET_KEY||"").trim();
 if(!posted||!secret)return false;
 const id=String(payload?.id||"");
 const amount=sarAmount(payload?.amount);
 const currency=String(payload?.currency||"");
 const gateway=String(payload?.reference?.gateway||"");
 const payment=String(payload?.reference?.payment||"");
 const status=String(payload?.status||"");
 const created=String(payload?.transaction?.created||payload?.created||"");
 const text=`x_id${id}x_amount${amount}x_currency${currency}x_gateway_reference${gateway}x_payment_reference${payment}x_status${status}x_created${created}`;
 const calculated=crypto.createHmac("sha256",secret).update(text).digest("hex");
 return safeEqual(calculated.toLowerCase(),posted.toLowerCase());
}

export function verifyTabby(headers:Headers){
 const name=String(process.env.TABBY_WEBHOOK_HEADER_NAME||"x-subil-tabby-webhook").toLowerCase();
 const expected=String(process.env.TABBY_WEBHOOK_HEADER_VALUE||"");
 const received=headers.get(name)||"";
 return Boolean(expected&&received&&safeEqual(expected,received));
}

function b64url(value:string){return Buffer.from(value.replace(/-/g,"+").replace(/_/g,"/"),"base64")}

export function verifyTamara(headers:Headers,url:URL){
 const secret=String(process.env.TAMARA_NOTIFICATION_TOKEN||"").trim();
 const auth=headers.get("authorization")||"";
 const token=(auth.match(/^Bearer\s+(.+)$/i)?.[1]||url.searchParams.get("tamaraToken")||"").trim();
 if(!secret||!token)return false;
 const parts=token.split(".");if(parts.length!==3)return false;
 try{
   const [head,payload,sig]=parts;
   const expected=crypto.createHmac("sha256",secret).update(`${head}.${payload}`).digest();
   const actual=b64url(sig);
   if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return false;
   const body=JSON.parse(b64url(payload).toString("utf8"));
   if(body?.exp&&Date.now()/1000>Number(body.exp))return false;
   return true;
 }catch{return false}
}

export function normalizePaymentEvent(provider:string,payload:AnyRecord){
 let providerReference="",orderId="",rawStatus="",status:"paid"|"pending"|"failed"|"cancelled"="pending";
 if(provider==="tap"){
   providerReference=String(payload?.id||"");orderId=String(payload?.reference?.order||"");rawStatus=String(payload?.status||"").toUpperCase();
   status=["CAPTURED","AUTHORIZED"].includes(rawStatus)?"paid":["CANCELLED","ABANDONED","VOID"].includes(rawStatus)?"cancelled":["FAILED","DECLINED"].includes(rawStatus)?"failed":"pending";
 }else if(provider==="amwal"){
   const data=payload?.data||payload;providerReference=String(data?.id||data?.transaction_id||data?.payment_link_id||"");orderId=String(data?.order_details?.order_id||payload?.order_id||"");rawStatus=String(data?.status||payload?.event_type||payload?.event||"").toLowerCase();
   status=(rawStatus==="success"||rawStatus==="order.success")?"paid":(rawStatus.includes("fail")||rawStatus.includes("reject"))?"failed":rawStatus.includes("expired")?"cancelled":"pending";
 }else if(provider==="tabby"){
   providerReference=String(payload?.id||"");orderId=String(payload?.order?.reference_id||payload?.meta?.order_id||"");rawStatus=String(payload?.status||"").toLowerCase();
   status=["closed","authorized"].includes(rawStatus)?"paid":["rejected"].includes(rawStatus)?"failed":["expired"].includes(rawStatus)?"cancelled":"pending";
 }else if(provider==="tamara"){
   providerReference=String(payload?.order_id||payload?.orderId||payload?.id||"");orderId=String(payload?.order_reference_id||payload?.orderReferenceId||payload?.order_number||"");rawStatus=String(payload?.status||payload?.event_type||"").toLowerCase();
   status=/(approved|authorised|authorized|captured|fully_captured|paid|success)/.test(rawStatus)?"paid":/(cancel|expired)/.test(rawStatus)?"cancelled":/(declin|fail|reject)/.test(rawStatus)?"failed":"pending";
 }
 return {provider,providerReference,orderId,status,rawStatus,receivedAt:new Date().toISOString()};
}

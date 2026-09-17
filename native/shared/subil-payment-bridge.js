(function(){
  if(window.SubilNativePayments) return;
  const pending=new Map();
  let seq=0;
  function send(payload){
    if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.SubilNativePayments){
      window.webkit.messageHandlers.SubilNativePayments.postMessage(payload);return true;
    }
    if(window.SubilAndroidPayments&&typeof window.SubilAndroidPayments.start==='function'){
      window.SubilAndroidPayments.start(JSON.stringify(payload));return true;
    }
    return false;
  }
  window.__subilResolveNativePayment=function(id,result){
    const item=pending.get(String(id));if(!item)return;
    pending.delete(String(id));item.resolve(result);
  };
  window.__subilRejectNativePayment=function(id,message){
    const item=pending.get(String(id));if(!item)return;
    pending.delete(String(id));item.reject(new Error(message||'native_payment_failed'));
  };
  window.SubilNativePayments={
    isAvailable:function(){return Boolean((window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.SubilNativePayments)||window.SubilAndroidPayments)},
    start:function(request){return new Promise(function(resolve,reject){const id=String(++seq);pending.set(id,{resolve,reject});if(!send({id:id,request:request})){pending.delete(id);reject(new Error('native_payment_bridge_unavailable'));}})}
  };
})();

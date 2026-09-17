export async function register(){
 if(process.env.NEXT_RUNTIME!=="nodejs")return;
 console.log(JSON.stringify({
  event:"subil.payment_readiness",
  status:"ready",
  architecture:"woocommerce_hosted_native_webview",
  source:"woocommerce_store_api",
  secrets_in_render_required:false,
  note:"Payment gateways are configured and executed by WooCommerce; availability is resolved per cart at runtime."
 }));
}

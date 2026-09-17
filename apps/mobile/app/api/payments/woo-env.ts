export function wooConsumerKey(){return String(process.env.WOO_CONSUMER_KEY||process.env.WOOCOMMERCE_CONSUMER_KEY||"").trim()}
export function wooConsumerSecret(){return String(process.env.WOO_CONSUMER_SECRET||process.env.WOOCOMMERCE_CONSUMER_SECRET||"").trim()}
export function wooBase(){return String(process.env.SUBIL_WOO_REST_API_BASE||process.env.WOOCOMMERCE_BASE_URL||"https://subil.store/wp-json/wc/v3").replace(/\/$/,"")}
export function wooMissing(){const missing:string[]=[];if(!wooConsumerKey())missing.push("WOO_CONSUMER_KEY|WOOCOMMERCE_CONSUMER_KEY");if(!wooConsumerSecret())missing.push("WOO_CONSUMER_SECRET|WOOCOMMERCE_CONSUMER_SECRET");return missing}

import type {MetadataRoute} from "next";
export default function manifest():MetadataRoute.Manifest{return{name:"سبيل ستور",short_name:"سبيل",description:"متابعة الطلبات والخدمات والصيانة",start_url:"/",display:"standalone",background_color:"#f5f8f7",theme_color:"#20a957",lang:"ar",dir:"rtl",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}]}}

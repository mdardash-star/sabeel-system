import type {Metadata,Viewport} from "next";import "./globals.css";import"./push.css";import StoreLinkInterceptor from "./store-link-interceptor";
export const metadata:Metadata={title:"سبيل | تطبيق العميل",description:"طلبات وخدمات عملاء سبيل",applicationName:"سبيل",appleWebApp:{capable:true,title:"سبيل",statusBarStyle:"default"}};
export const viewport:Viewport={themeColor:"#20a957",width:"device-width",initialScale:1};
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ar" dir="rtl"><body><StoreLinkInterceptor/>{children}</body></html>}

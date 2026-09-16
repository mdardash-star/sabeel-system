import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./push.css";

export const metadata: Metadata = {
  title: "سبيل | بوابة الفني",
  description: "مهام ومحفظة فني سبيل",
  applicationName: "سبيل للفنيين",
  appleWebApp: { capable: true, title: "فني سبيل", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#075a9c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "سبيل للفنيين",
    short_name: "فني سبيل",
    description: "إدارة مهام الفنيين الميدانية في سبيل",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f8",
    theme_color: "#075a9c",
    lang: "ar",
    dir: "rtl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}

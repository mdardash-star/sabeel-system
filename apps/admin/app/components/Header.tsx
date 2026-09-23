"use client";
const nav:Array<[string,string]>=[
  ["لوحة التحكم","/"],
  ["المهام","/jobs"],
  ["العملاء","/customers"],
  ["الفنيون","/technicians"],
  ["الصيانة","/maintenance"],
  ["المالية","/finance"],
  ["المخزون","/inventory"],
  ["المشتريات","/purchasing"],
  ["التقارير","/reports"],
  ["التسويق","/marketing"],
  ["المحادثات","/conversations"],
  ["سبيل AI","/ai"],
  ["المستخدمون","/users"],
];
export default function Header({active}:{active:string}){
  return <header className="customers-top"><a className="customers-brand" href="/"><span>S</span><strong>سبيل</strong><small>نظام التشغيل</small></a><nav className="section-nav" aria-label="تنقل الأقسام">{nav.map(([label,href])=><a key={href} className={active===href?"active":""} href={href}>{label}</a>)}</nav><div className="profile-avatar">م</div></header>;
}

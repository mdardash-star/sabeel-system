"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const adminRoles = new Set(["dispatcher", "support", "finance", "branch_manager", "admin", "super_admin"]);

export default function PreviewAuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("subil_session");
    const role = sessionStorage.getItem("subil_role");

    if (!token || !role || !adminRoles.has(role)) {
      router.replace("/login");
      return;
    }

    setAuthorized(true);
  }, [router]);

  if (!authorized) {
    return <main className="auth-loading" aria-label="جارٍ التحقق من جلسة الدخول" />;
  }

  return children;
}

"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { if (!session.isPending && !session.data) router.replace(`/${pathname.split("/")[1] || "ca"}/login`); }, [session.isPending, session.data, router, pathname]);
  if (session.isPending || !session.data) return <main className="auth-loading"><LoaderCircle className="spin" aria-label="Loading" /></main>;
  return children;
}

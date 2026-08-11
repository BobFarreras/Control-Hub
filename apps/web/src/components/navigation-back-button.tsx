"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const TRAIL_KEY = "control-hub.navigation-trail";
const MAX_TRAIL_LENGTH = 40;

function readTrail(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function NavigationBackButton({
  label,
  fallbackHref,
  hidden = false
}: {
  label: string;
  fallbackHref: string;
  hidden?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const route = pathname;

  useEffect(() => {
    const trail = readTrail();
    const existingIndex = trail.lastIndexOf(route);
    const next = existingIndex >= 0 ? trail.slice(0, existingIndex + 1) : [...trail, route].slice(-MAX_TRAIL_LENGTH);
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(next));
  }, [route]);

  function goBack() {
    const trail = readTrail();
    if (trail.length > 1 && trail.at(-1) === route) {
      sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(0, -1)));
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  if (hidden) return null;

  return (
    <button className="topbar-back" type="button" onClick={goBack} aria-label={label} title={label}>
      <ArrowLeft size={18} />
      <span>{label}</span>
    </button>
  );
}

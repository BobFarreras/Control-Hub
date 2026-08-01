"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <button className="icon-button" type="button" title={label} aria-label={label} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} disabled={!mounted}>{mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>;
}

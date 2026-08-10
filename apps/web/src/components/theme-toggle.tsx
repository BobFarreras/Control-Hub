"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

/** The resolved theme is only known in the browser, so the server and the first client render
 *  must agree on "unknown". Reading that through a store keeps it out of an effect, which would
 *  otherwise schedule a second render on every mount just to flip a boolean. */
const subscribeToNothing = () => () => undefined;

export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
  return (
    <button
      className="icon-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      disabled={!mounted}
    >
      {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

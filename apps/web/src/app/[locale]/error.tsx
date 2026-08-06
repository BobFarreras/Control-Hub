"use client";

import { getUnreachableDictionary, isLocale } from "@control-hub/i18n";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useParams } from "next/navigation";

/**
 * What a signed-in person sees when the page could not be rendered.
 *
 * It exists so that the API being briefly unreachable, which `tsx watch` causes on every edit of a
 * server file, does not look like being signed out. `requireSession` throws instead of redirecting
 * in that case, and this is where it lands: the session is untouched and `reset()` re-renders the
 * route on the server, so retrying costs a click rather than a whole sign-in with a second factor.
 *
 * The message says nothing about what failed inside. A boundary is shown to whoever is using the
 * product, and an internal detail on that screen is noise at best.
 */
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const localeParam = String(useParams().locale);
  const t = getUnreachableDictionary(isLocale(localeParam) ? localeParam : "ca");

  return (
    <main className="boundary-page">
      <section role="alert">
        <AlertTriangle size={28} aria-hidden="true" />
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <button className="primary-button" onClick={() => reset()} autoFocus>
          <RotateCw size={17} aria-hidden="true" />
          {t.retry}
        </button>
      </section>
    </main>
  );
}

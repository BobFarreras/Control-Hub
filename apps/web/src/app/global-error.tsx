"use client";

import { getUnreachableDictionary, isLocale, type Locale } from "@control-hub/i18n";
import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";

/**
 * What somebody sees when the root layout itself could not render.
 *
 * `[locale]/error.tsx` catches everything inside a locale segment, which is almost everything --
 * but not the root layout above it, and not the document. That is what lands here, and until this
 * file existed the answer was Next's built-in page: unstyled, in English, and reporting nothing.
 *
 * Three constraints shape it, all of them from the framework rather than from taste. It has to be
 * a Client Component, because an error boundary is. It has to render its own `<html>` and
 * `<body>`, because it replaces the root layout rather than nesting inside it. And the global
 * stylesheet does not reach it, so every rule it needs is written here -- which is also why it is
 * deliberately plain: a page that depends on a design system is a page that fails when the design
 * system is what failed.
 *
 * It also reports. This is the one boundary whose errors nobody can see from inside the product,
 * so `captureException` here is the difference between knowing and guessing.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // The locale lives in the path, and the path is only knowable in the browser: this document is
  // prerendered once, with no segment to read. The address bar is therefore an external system,
  // and reading it through `useSyncExternalStore` is what lets React serve the default language
  // and switch to the right one on mount without the two renders being called a mismatch.
  const locale = useSyncExternalStore(neverChanges, localeInAddressBar, defaultLocale);
  const t = getUnreachableDictionary(locale);

  return (
    <html lang={locale}>
      <body style={page}>
        <main style={card} role="alert">
          <h1 style={heading}>{t.title}</h1>
          <p style={body}>{t.body}</p>
          <button style={action} onClick={() => retry()} type="button" autoFocus>
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}

/** Nothing can navigate away from this page without replacing the document, so there is nothing to subscribe to. */
const neverChanges = () => () => {};

const localeInAddressBar = (): Locale => {
  const segment = window.location.pathname.split("/")[1] ?? "";
  return isLocale(segment) ? segment : "ca";
};

/** What the prerendered document says, before any address bar exists to read. */
const defaultLocale = (): Locale => "ca";

/**
 * The colours of the product, written twice rather than imported.
 *
 * `light-dark()` follows the operating system, which is the only preference available here: the
 * theme the person chose lives in an attribute the root layout sets, and the root layout is
 * exactly what did not render.
 */
const page: React.CSSProperties = {
  margin: 0,
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  colorScheme: "light dark",
  background: "light-dark(#f5f2ee, #1a1a1e)",
  color: "light-dark(#2c2824, #e8e4df)",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
};

const card: React.CSSProperties = {
  maxWidth: "440px",
  padding: "28px",
  borderRadius: "8px",
  border: "1px solid light-dark(#d6cfc5, #3a3a40)",
  background: "light-dark(#fffdf9, #222226)",
  textAlign: "center"
};

const heading: React.CSSProperties = { margin: "0 0 12px", fontSize: "20px" };

const body: React.CSSProperties = { margin: "0 0 20px", color: "light-dark(#7a7067, #9a9590)" };

const action: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: "6px",
  border: "none",
  cursor: "pointer",
  fontSize: "15px",
  background: "light-dark(#8b5e3c, #c89b6a)",
  color: "light-dark(#fffdf9, #1a1a1e)"
};

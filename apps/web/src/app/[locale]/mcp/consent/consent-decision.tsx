"use client";

import { getMcpDictionary, mcpErrorMessage, mcpScopeLabel, type Locale } from "@control-hub/i18n";
import { Check, Eye, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { McpConsentRequest } from "@/lib/api-types";

/**
 * The decision itself, and the only interactive part of this screen.
 *
 * Everything rendered here came from the API, not from the address: `description` is the answer to
 * a re-read, so the name shown is the registered one and the scopes shown are the ones that would
 * really be granted to this person. `request` is the agent's parameters, carried through untouched
 * so the POST asks the same question the GET described -- the API validates it again, and the
 * address the browser ends at is the one the API matched, never one composed here.
 *
 * Refusing is offered as plainly as allowing. A screen where the only styled button is "allow" is
 * a screen that has made the decision for the reader.
 */
export function ConsentDecision({
  locale,
  description,
  request
}: {
  locale: Locale;
  description: McpConsentRequest;
  request: Record<string, string>;
}) {
  const t = getMcpDictionary(locale);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError("");
    setStale(false);
    const response = await fetch("/api/v1/mcp/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, decision })
    });
    const payload = (await response.json().catch(() => ({}))) as { redirectTo?: string; code?: string };

    if (response.ok && payload.redirectTo) {
      // Not `router.push`: the destination belongs to the client that started this, which is
      // usually a loopback port on this machine and never a route in this application.
      window.location.assign(payload.redirectTo);
      return;
    }

    setBusy(null);
    // Sending somebody to sign in again is only right for the one refusal that says so. Every
    // other code is a fact about the request, and re-authenticating would not change it.
    if (payload.code === "SESSION_NOT_FRESH") return setStale(true);
    setError(mcpErrorMessage(locale, payload.code));
  }

  const here = typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;

  return (
    <main className="consent-page">
      <section className="consent-card">
        <span className="consent-eyebrow">{t.eyebrow}</span>
        <ShieldCheck size={28} />
        <h1>{t.title}</h1>
        <p className="consent-subtitle">{t.subtitle}</p>

        <dl className="consent-facts">
          <div>
            <dt>{t.clientLabel}</dt>
            <dd>
              <strong>{description.clientName}</strong>
              <small>{description.clientKind === "public" ? t.kindPublic : t.kindConfidential}</small>
            </dd>
          </div>
          <div>
            <dt>{t.redirectLabel}</dt>
            <dd>
              <code>{description.redirectUri}</code>
            </dd>
          </div>
          <div>
            <dt>{t.expiresLabel}</dt>
            <dd>{new Date(description.grantExpiresAt).toLocaleDateString(locale)}</dd>
          </div>
        </dl>

        <div className="consent-scopes">
          <h2>{t.scopesTitle}</h2>
          <p>{t.scopesDescription}</p>
          <ul>
            {description.scopes.map((scope) => (
              <li key={scope}>
                <Eye size={16} />
                {mcpScopeLabel(locale, scope)}
              </li>
            ))}
          </ul>
          <p className="consent-note">{t.scopesOwn}</p>
        </div>

        {stale && (
          <p className="form-error" role="alert">
            {t.errorSessionNotFresh}{" "}
            <a className="text-link" href={`/${locale}/login?next=${encodeURIComponent(here)}`}>
              {t.signInAgain}
            </a>
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="consent-actions">
          <button className="secondary-button" disabled={busy !== null} onClick={() => void decide("deny")}>
            {busy === "deny" ? <LoaderCircle className="spin" size={18} /> : <X size={17} />}
            {busy === "deny" ? t.deciding : t.deny}
          </button>
          <button className="primary-button" disabled={busy !== null} onClick={() => void decide("approve")}>
            {busy === "approve" ? <LoaderCircle className="spin" size={18} /> : <Check size={17} />}
            {busy === "approve" ? t.deciding : t.approve}
          </button>
        </div>
        <p className="consent-note">{t.freshnessNote}</p>
        <p className="consent-note">{t.revokeNote}</p>
      </section>
    </main>
  );
}

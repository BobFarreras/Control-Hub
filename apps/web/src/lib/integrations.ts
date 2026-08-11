import type { StatusTone } from "@/components/status-pill";
import type { ConnectorHealthStatus, ConnectorInstanceStatus } from "@/lib/api-types";

/**
 * How the integrations screen reads what the API said.
 *
 * Pure on purpose: the tone of a health reading and the sentence an error code becomes are the
 * two things most likely to drift, and both are testable here without rendering anything.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

/**
 * The tone of each state. Never the only carrier of meaning: `StatusPill` always draws the word
 * and an icon beside it, which is what makes a health reading legible in greyscale.
 */
export const instanceStatusTone: Record<ConnectorInstanceStatus, StatusTone> = {
  draft: "neutral",
  enabled: "active",
  disabled: "warning",
  error: "danger"
};

export const healthTone: Record<ConnectorHealthStatus, StatusTone> = {
  unknown: "neutral",
  healthy: "done",
  degraded: "warning",
  failing: "danger",
  disabled: "closed"
};

/**
 * The dictionary key an API error code becomes.
 *
 * The rule is mechanical — `INSTANCE_NOT_ENABLED` reads `errorInstanceNotEnabled` — so a code the
 * API adds has one predictable place to be translated, and nothing on this screen ever renders a
 * provider's own words: what arrives is a code, and what is shown is our sentence for it.
 */
export function errorLabelKey(code: string): string {
  const parts = code
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0);
  return ["error", ...parts.map((part) => part[0]!.toUpperCase() + part.slice(1))].join("");
}

/** The sentence for a code, or the general one. An untranslated code is never shown raw. */
export function errorMessage(labels: Record<string, string>, code: string | null | undefined): string {
  const translated = code ? labels[errorLabelKey(code)] : undefined;
  return translated ?? labels.errorUnknown ?? "";
}

/**
 * The problem document an unsuccessful call carries, reduced to the one field a screen may use.
 *
 * RFC 9457 also carries a `title` and a `detail`, and neither is translated: they are English,
 * written for a log. The `code` is the part the product localises, which is exactly why the two
 * error envelopes this API still has were made to agree on it.
 */
export function problemCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * The absolute address a provider posts to.
 *
 * The API answers with a path, because the only thing it knows about its own public address is a
 * `Host` header the caller chose. The browser does know: it is talking to it.
 */
export function webhookUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

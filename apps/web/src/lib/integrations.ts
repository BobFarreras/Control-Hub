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
 * The dictionary key an error code becomes, under a given namespace.
 *
 * The rule is mechanical — `INSTANCE_NOT_ENABLED` reads `errorInstanceNotEnabled` — so a code the
 * API adds has one predictable place to be translated, and nothing on this screen ever renders a
 * provider's own words: what arrives is a code, and what is shown is our sentence for it.
 */
function labelKey(prefix: string, code: string): string {
  const parts = code
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0);
  return [prefix, ...parts.map((part) => part[0]!.toUpperCase() + part.slice(1))].join("");
}

export function errorLabelKey(code: string): string {
  return labelKey("error", code);
}

/**
 * The key for a code a **failed run** stored, which is a different vocabulary.
 *
 * They collide on words, and the collision is not cosmetic. `FORBIDDEN` from this API means the
 * reader lacks a permission; `FORBIDDEN` from a run means the provider refused the credential we
 * sent. One key would put one of those sentences under the other's code, and a confidently wrong
 * sentence is worse than a vague one: it sends somebody to check their own permissions when the
 * answer is at the far end.
 */
export function runErrorLabelKey(code: string): string {
  return labelKey("runError", code);
}

/** The sentence for a code, or the general one. An untranslated code is never shown raw. */
export function errorMessage(labels: Record<string, string>, code: string | null | undefined): string {
  const translated = code ? labels[errorLabelKey(code)] : undefined;
  return translated ?? labels.errorUnknown ?? "";
}

/**
 * Why a run failed, in the reader's language.
 *
 * The fallback stays, because a run is history: a record written by a release that knew a code
 * this one does not still has to render. What must not happen is the fallback being the answer
 * for a code we do ship — that is how "the operation could not be completed" ended up standing in
 * for "this address is not on the allowlist", which is a minute's work once somebody says it.
 * `packages/i18n` walks the vocabulary the domain declares and refuses that silence.
 */
export function runErrorMessage(labels: Record<string, string>, code: string | null | undefined): string {
  const translated = code ? labels[runErrorLabelKey(code)] : undefined;
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
 * Why a health reading is what it is, for a row that has not been opened.
 *
 * Empty when there is nothing to explain, so a caller draws the state on its own rather than a
 * gap where a sentence was expected. A healthy reading genuinely carries no code: `recordHealth`
 * writes `last_error_code` on every check, success included, so there is no stale reason to guard
 * against here.
 *
 * It reads the **run** vocabulary, not the API's. The two collide on words and mean different
 * things — see `runErrorLabelKey` above — and a listing is exactly where the wrong one would go
 * unnoticed longest.
 */
export function healthReason(labels: Record<string, string>, code: string | null | undefined): string {
  return code ? runErrorMessage(labels, code) : "";
}

/**
 * Where an old `?selected=` link should land, if anywhere.
 *
 * One integration used to be a selection on the listing and is now a route, so those links are
 * out in the world and are worth honouring. What is not worth honouring is whatever else somebody
 * puts in that parameter: it would be pasted straight into a path, so anything that is not shaped
 * like an identifier gets no redirect at all. The shape is checked rather than escaped — an
 * escaped `../..` is still an attempt, and there is no legitimate one to preserve.
 */
const instanceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function selectedInstancePath(locale: string, selected: string | undefined): string | null {
  if (!selected || !instanceId.test(selected)) return null;
  return `/${locale}/integrations/${selected}`;
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

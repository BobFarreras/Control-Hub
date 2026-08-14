/**
 * The words a screen puts on a connector, its fields and its credentials.
 *
 * Two rules, both of them lessons rather than preferences.
 *
 * **A connector type is not a translation key.** Types are kebab-case, because that is what a URL
 * and a registry want; keys are not, because a dictionary is an object. Skipping the conversion
 * does not fail, it just misses — and a lookup that misses falls back to the raw type, so
 * `generic-webhook` appears in front of an operator in a screen that is otherwise translated.
 * That is exactly how it shipped once, and why the conversion lives in one function now.
 *
 * **A field name means different things to different providers.** `baseUrl` is an n8n instance for
 * one connector and an API root for the next, so a connector may name its own wording and falls
 * back to the shared one when it has nothing special to say. The fallback is what keeps a new
 * connector legible before anybody has written a line of prose for it.
 */

export type Labels = Record<string, string>;

/** A connector type as it appears inside a translation key: `generic-webhook` is `generic_webhook`. */
export const labelKey = (type: string) => type.replace(/-/g, "_");

/** The connector's name as a person says it, falling back to the type the registry uses. */
export const connectorLabel = (t: Labels, type: string) => t[`connector_${labelKey(type)}`] ?? type;

/** One line about what connecting this actually gets you. Absent is fine: a card still works. */
export const connectorSummary = (t: Labels, type: string) => t[`connectorAbout_${labelKey(type)}`] ?? "";

/** A connector's own wording for a field, then the shared one, then the key itself. */
export const fieldLabel = (t: Labels, type: string, name: string) =>
  t[`field_${labelKey(type)}_${name}`] ?? t[`field_${name}`] ?? name;

/** The help under a field. Undefined rather than empty, so a control can leave the hint out. */
export const fieldHint = (t: Labels, type: string, name: string): string | undefined =>
  t[`fieldHint_${labelKey(type)}_${name}`] ?? t[`fieldHint_${name}`];

/** What a credential is called. The kinds are already identifiers, so no conversion is needed. */
export const credentialKindLabel = (t: Labels, kind: string) => t[`credentialKind_${kind}`] ?? kind;

/**
 * Where to go and get this secret.
 *
 * Undefined when nobody has written it for this provider, rather than falling back to the generic
 * warning about rotation: they answer different questions, and a caller that wants both says so.
 * "Settings, then API" is not advice that generalises, which is why it is keyed by connector.
 */
export const credentialKindHint = (t: Labels, type: string, kind: string): string | undefined =>
  t[`credentialHint_${labelKey(type)}_${kind}`];

/**
 * What the schema said is wrong, in words.
 *
 * The API sends a zod code and never the value, so this is a fixed vocabulary rather than a
 * message somebody wrote about one field. An unrecognised code still says something useful.
 */
export const issueMessage = (t: Labels, code: string) => t[`issue_${code}`] ?? t.issueInvalid ?? "";

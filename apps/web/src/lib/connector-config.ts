import type { ConnectorCatalogueEntry, ConnectorConfigField } from "@/lib/api-types";

/**
 * Turning a connector's declared fields into a form, and a filled-in form back into a
 * configuration.
 *
 * This is the half of "connect an integration without leaving the screen" that is worth testing
 * on its own: the component around it only decides which control to render, while the decisions
 * that can silently corrupt a configuration all live here. There are three of them, and each has
 * a test that fails when it is undone.
 *
 * **An optional field left blank is omitted, not sent empty.** The connector's schema owns the
 * defaults, and it is the only thing that knows them; sending `""` would replace a default with a
 * value the schema then refuses, and the operator would be told a field they skipped is invalid.
 *
 * **A toggle is always sent.** An unchecked box submits nothing, so the rule above would drop it
 * and the schema would restore its default — turning "off" into "on" whenever the default is on.
 *
 * **Nothing is coerced beyond its kind.** A number that is not a number travels as typed, so the
 * server can name the field. `Number("many")` is `NaN`, which JSON writes as `null`, and the
 * operator would be told the field was missing rather than wrong.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

/** Reads one control out of a submitted form. `null` means the control sent nothing. */
export type FormReader = (name: string) => string | null;

const listSeparators = /[\n,]/;

/**
 * A stored value as a control can show it.
 *
 * Anything that is not a string, a number or a boolean comes back empty rather than as
 * `[object Object]`: a nested value has no control here, and printing its stringification into a
 * text input would offer an operator something they cannot edit back into the same shape.
 */
function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * What a control starts out holding: the configured value, or failing that the connector's own
 * default, so a form for something nobody has set up yet opens showing what it would do anyway.
 *
 * The fallback is only reached when the configuration has nothing at all for the field. A stored
 * value wins even when it is falsy — `0`, `false`, an empty string — because somebody chose it.
 */
function startingValue(field: ConnectorConfigField, config: Record<string, unknown>): unknown {
  const value = config[field.name];
  return value === undefined || value === null ? field.defaultValue : value;
}

/** What the form holds for a field, as the control for its kind wants it. */
export function fieldValue(field: ConnectorConfigField, config: Record<string, unknown>): string {
  const value = startingValue(field, config);
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map(scalar)
      .filter((item) => item !== "")
      .join(", ");
  }
  return scalar(value);
}

/** Whether a toggle starts on. A key neither the configuration nor the connector answers is off. */
export function isChecked(field: ConnectorConfigField, config: Record<string, unknown>): boolean {
  return startingValue(field, config) === true;
}

export function configFromForm(fields: readonly ConnectorConfigField[], read: FormReader): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = read(field.name);

    if (field.kind === "toggle") {
      config[field.name] = raw !== null;
      continue;
    }

    const value = (raw ?? "").trim();
    if (value === "") continue;

    if (field.kind === "number") {
      const parsed = Number(value);
      config[field.name] = Number.isFinite(parsed) ? parsed : value;
      continue;
    }

    if (field.kind === "list") {
      const items = value
        .split(listSeparators)
        .map((item) => item.trim())
        .filter((item) => item !== "");
      if (items.length > 0) config[field.name] = items;
      continue;
    }

    config[field.name] = value;
  }
  return config;
}

/**
 * The one secret a create form should ask for, or nothing.
 *
 * Connecting a provider means pasting the token our calls authenticate with, so a connector that
 * makes no calls has nothing to ask for at this point: an inbound-only connector receives, and
 * the secret it verifies with is minted along with its endpoint rather than typed by anybody.
 * Offering a field for it would invite an operator to paste a token that nothing would ever send.
 *
 * Where a connector declares several kinds, the first is the one that connects — declared order
 * carries meaning here in the same way it does for fields, where it is the order of the form.
 */
export function connectCredentialKind(
  entry: Pick<ConnectorCatalogueEntry, "credentialKinds" | "capabilities"> | undefined
): string | null {
  if (!entry || !entry.capabilities.egress) return null;
  return entry.credentialKinds[0] ?? null;
}

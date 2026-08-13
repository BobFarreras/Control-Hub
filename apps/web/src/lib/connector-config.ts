import type { ConnectorConfigField } from "@/lib/api-types";

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

/** What the stored configuration holds for a field, as the control for its kind wants it. */
export function fieldValue(field: ConnectorConfigField, config: Record<string, unknown>): string {
  const value = config[field.name];
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map(scalar)
      .filter((item) => item !== "")
      .join(", ");
  }
  return scalar(value);
}

/** Whether a toggle starts on. A key the configuration never had is off, not undefined. */
export function isChecked(field: ConnectorConfigField, config: Record<string, unknown>): boolean {
  return config[field.name] === true;
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

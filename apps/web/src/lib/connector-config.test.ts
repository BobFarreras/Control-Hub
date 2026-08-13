import { describe, expect, it } from "vitest";
import type { ConnectorConfigField } from "./api-types.js";
import { configFromForm, fieldValue, isChecked } from "./connector-config.js";

const fields: ConnectorConfigField[] = [
  { name: "baseUrl", kind: "url", required: true },
  { name: "includeArchived", kind: "toggle", required: false },
  { name: "executionsWindowHours", kind: "number", required: false },
  { name: "eventTypes", kind: "list", required: false },
  { name: "label", kind: "text", required: false }
];

/** A form as the browser hands it over: absent means the control sent nothing. */
const form = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe("turning a filled-in form into a configuration", () => {
  it("sends what was typed, with each kind as its own type rather than as a string", () => {
    expect(
      configFromForm(
        fields,
        form({ baseUrl: "https://n8n.example.com", executionsWindowHours: "48", label: "Nightly" })
      )
    ).toEqual({
      baseUrl: "https://n8n.example.com",
      includeArchived: false,
      executionsWindowHours: 48,
      label: "Nightly"
    });
  });

  /**
   * The difference between "leave it alone" and "empty".
   *
   * An optional field nobody filled in is left out entirely, so the connector's own default
   * applies. Sending `""` instead would be a value, and a schema that wants a URL would refuse it
   * — an error about a field the operator deliberately skipped.
   */
  it("omits an optional field left blank instead of sending an empty value", () => {
    const config = configFromForm(fields, form({ baseUrl: "https://n8n.example.com" }));
    expect(config).not.toHaveProperty("executionsWindowHours");
    expect(config).not.toHaveProperty("label");
    expect(config).not.toHaveProperty("eventTypes");
  });

  /**
   * A toggle is the one kind that cannot be omitted when empty. An unchecked box sends nothing,
   * and leaving it out would restore a default of `true` — turning the operator's decision to
   * switch something off into a decision to switch it back on.
   */
  it("still sends a toggle nobody touched, because unchecked is an answer", () => {
    expect(configFromForm(fields, form({ baseUrl: "https://n8n.example.com" })).includeArchived).toBe(false);
    expect(
      configFromForm(fields, form({ baseUrl: "https://n8n.example.com", includeArchived: "on" })).includeArchived
    ).toBe(true);
  });

  it("splits a list on commas and newlines, and keeps no blanks from the gaps", () => {
    const config = configFromForm(
      fields,
      form({ baseUrl: "https://n8n.example.com", eventTypes: " created, ,updated\n deleted , " })
    );
    expect(config.eventTypes).toEqual(["created", "updated", "deleted"]);
  });

  it("trims what was pasted, because a trailing space in a URL is not a URL", () => {
    expect(configFromForm(fields, form({ baseUrl: "  https://n8n.example.com  " })).baseUrl).toBe(
      "https://n8n.example.com"
    );
  });

  /**
   * A number the browser let through as nonsense is sent as it was typed rather than as `NaN`,
   * which does not survive JSON and would arrive as `null` — an error pointing at the wrong
   * problem. The server names the field; the operator sees which one it was.
   */
  it("does not invent a number out of something that is not one", () => {
    expect(configFromForm(fields, form({ baseUrl: "https://x.test", executionsWindowHours: "many" }))).toMatchObject({
      executionsWindowHours: "many"
    });
  });
});

describe("filling a form in from a configuration that already exists", () => {
  const stored = {
    baseUrl: "https://n8n.example.com",
    includeArchived: true,
    executionsWindowHours: 48,
    eventTypes: ["created", "updated"]
  };

  it("shows every kind the way its control expects it", () => {
    expect(fieldValue(fields[0]!, stored)).toBe("https://n8n.example.com");
    expect(fieldValue(fields[2]!, stored)).toBe("48");
    expect(fieldValue(fields[3]!, stored)).toBe("created, updated");
  });

  it("leaves a control empty for a key the stored configuration never had", () => {
    expect(fieldValue(fields[4]!, stored)).toBe("");
  });

  it("reads a toggle as checked or not, and treats a missing key as off", () => {
    expect(isChecked(fields[1]!, stored)).toBe(true);
    expect(isChecked(fields[1]!, {})).toBe(false);
  });

  /** A round trip must not change a configuration nobody edited. */
  it("gives back what it was given when nothing is touched", () => {
    const values: Record<string, string> = {};
    for (const field of fields) {
      if (field.kind === "toggle") {
        if (isChecked(field, stored)) values[field.name] = "on";
        continue;
      }
      const value = fieldValue(field, stored);
      if (value !== "") values[field.name] = value;
    }
    expect(configFromForm(fields, form(values))).toEqual(stored);
  });
});

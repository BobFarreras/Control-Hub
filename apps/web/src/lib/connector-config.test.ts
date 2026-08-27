import { describe, expect, it } from "vitest";
import type { ConnectorConfigField } from "./api-types.js";
import { configFromForm, connectCredentialKind, fieldValue, isChecked } from "./connector-config.js";

const fields: ConnectorConfigField[] = [
  { name: "baseUrl", kind: "url", group: "connection", required: true, defaultValue: null },
  { name: "includeArchived", kind: "toggle", group: "behaviour", required: false, defaultValue: false },
  { name: "executionsWindowHours", kind: "number", group: "behaviour", required: false, defaultValue: 24 },
  { name: "eventTypes", kind: "list", group: "behaviour", required: false, defaultValue: [] },
  { name: "label", kind: "text", group: "behaviour", required: false, defaultValue: null }
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

/**
 * What a form shows before anybody has configured anything.
 *
 * A blank input is a question; an input already holding the connector's own default is an answer
 * offered for confirmation, which is the difference between a form somebody has to go and research
 * and one they can read and submit. The default is the connector's own, carried by the catalogue —
 * never a value invented here, because a guessed default is worse than an empty field.
 */
describe("opening a form for a connector nobody has configured yet", () => {
  it("offers the connector's own default, so the form shows what it would do anyway", () => {
    expect(fieldValue(fields[2]!, {})).toBe("24");
    expect(isChecked({ ...fields[1]!, defaultValue: true }, {})).toBe(true);
  });

  it("leaves the control empty when the connector answers nothing either", () => {
    expect(fieldValue(fields[0]!, {})).toBe("");
    expect(fieldValue(fields[4]!, {})).toBe("");
  });

  /** An empty list default is still an answer, and an answer of "nothing" reads as an empty box. */
  it("shows an empty list default as an empty control rather than as a stray separator", () => {
    expect(fieldValue(fields[3]!, {})).toBe("");
    expect(fieldValue({ ...fields[3]!, defaultValue: ["created", "updated"] }, {})).toBe("created, updated");
  });

  /**
   * A configured value always wins, including one that happens to be falsy: a toggle somebody
   * deliberately switched off must not come back on because the connector's default says on.
   */
  it("prefers what is stored over the default, even when what is stored is off", () => {
    expect(isChecked({ ...fields[1]!, defaultValue: true }, { includeArchived: false })).toBe(false);
    expect(fieldValue(fields[2]!, { executionsWindowHours: 48 })).toBe("48");
  });
});

/**
 * Which secret, if any, belongs in the form that creates an integration.
 *
 * The distinction is what the connector does, not what it declares: one that goes out and fetches
 * has to authenticate, and one that only receives verifies with a secret the platform mints. A
 * field for the second would be a place to paste a token nothing ever sends.
 */
describe("deciding whether creating an integration should ask for a secret", () => {
  const outbound = {
    credentialKinds: ["api_token", "ingress_signing"],
    capabilities: {
      egress: { schemes: ["https"], destination: "operator_allowlist" },
      operations: ["pull_workflows"],
      ingress: true,
      oauth: null
    }
  };
  const inboundOnly = {
    credentialKinds: ["ingress_signing"],
    capabilities: { egress: null, operations: [], ingress: true, oauth: null }
  };

  it("asks for the first kind a connector that calls out declares", () => {
    expect(connectCredentialKind(outbound)).toBe("api_token");
  });

  it("asks for nothing from a connector that only receives", () => {
    expect(connectCredentialKind(inboundOnly)).toBeNull();
  });

  it("never asks somebody to paste a platform-managed OAuth token", () => {
    expect(
      connectCredentialKind({
        ...outbound,
        capabilities: { ...outbound.capabilities, oauth: { provider: "google" as const } }
      })
    ).toBeNull();
  });

  it("asks for nothing when no connector has been chosen yet", () => {
    expect(connectCredentialKind(undefined)).toBeNull();
    expect(connectCredentialKind({ ...outbound, credentialKinds: [] })).toBeNull();
  });
});

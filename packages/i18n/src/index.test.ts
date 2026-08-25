import { connectorRegistry } from "@control-hub/connectors";
import {
  connectorDiagnosisSteps,
  connectorErrorCodes,
  infrastructureErrorCodes,
  mcpOauthDenialCodes,
  mcpScopes
} from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import {
  getAttendanceDictionary,
  getDictionary,
  getInfrastructureDictionary,
  getIntegrationsDictionary,
  getMcpDictionary,
  locales,
  mcpErrorMessage,
  mcpScopeLabel
} from "./index.js";

/**
 * A key added to one locale and forgotten in the others renders the key name at somebody, or
 * nothing at all, and only in the language nobody on the team reads back. Comparing the shapes
 * catches it here instead.
 */
function expectSameShapeInEveryLocale(read: (locale: (typeof locales)[number]) => Record<string, string>) {
  const [first, ...rest] = locales.map(read);
  const expected = Object.keys(first!).sort();
  for (const dictionary of rest) expect(Object.keys(dictionary).sort()).toEqual(expected);
  for (const dictionary of [first!, ...rest])
    for (const [key, value] of Object.entries(dictionary)) expect(value.trim(), key).not.toBe("");
}

describe("dictionaries", () => {
  it("has a title for every locale", () => {
    for (const locale of locales) expect(getDictionary(locale).dashboard.title.length).toBeGreaterThan(0);
  });

  it("gives every locale the same keys, with nothing left empty", () => {
    expectSameShapeInEveryLocale(getAttendanceDictionary);
  });

  it("does the same for the connector platform", () => {
    expectSameShapeInEveryLocale(getIntegrationsDictionary);
  });

  it("does the same for the infrastructure module", () => {
    expectSameShapeInEveryLocale(getInfrastructureDictionary);
  });

  it("does the same for the consent screen", () => {
    expectSameShapeInEveryLocale(getMcpDictionary);
  });
});

/**
 * The consent screen is the one place a person decides what a stranger's software may read, and it
 * is reached in whatever language their browser asks for. A scope with no sentence would arrive as
 * `infrastructure.read` in the middle of a paragraph of Catalan, which is not a description of
 * anything -- it is a line somebody clicks past.
 *
 * The closed lists in `@control-hub/domain` are walked rather than copied, and they are walked
 * through the very functions the screen calls: a derivation proved here and performed there could
 * drift, and the drift is silent.
 */
describe("the words a person approves an agent in", () => {
  it("says what every scope this build offers would let an agent read, in every locale", () => {
    for (const locale of locales) {
      for (const scope of mcpScopes) {
        const label = mcpScopeLabel(locale, scope);
        expect(label, `${scope} in ${locale}`).toBeTruthy();
        // A label that is the identifier is the lookup having missed.
        expect(label, `${scope} in ${locale}`).not.toBe(scope);
      }
    }
  });

  it("explains every way this flow can refuse, in every locale", () => {
    for (const locale of locales) {
      const generic = getMcpDictionary(locale).errorUnknown;
      for (const code of mcpOauthDenialCodes) {
        expect(mcpErrorMessage(locale, code), `${code} in ${locale}`).not.toBe(generic);
      }
    }
  });

  /**
   * The refusal a person is most likely to meet, and it comes from the API's own freshness rule
   * rather than from the MCP vocabulary: it is what they get for taking their time over the
   * decision. Answering it with the generic sentence would say nothing at the exact moment
   * somebody needs to be told to sign in again.
   */
  it("explains a stale session too, which no closed list would have caught", () => {
    for (const locale of locales) {
      expect(mcpErrorMessage(locale, "SESSION_NOT_FRESH"), locale).not.toBe(getMcpDictionary(locale).errorUnknown);
    }
  });

  it("answers something it has never heard of with the sentence that admits as much", () => {
    for (const locale of locales) {
      const generic = getMcpDictionary(locale).errorUnknown;
      for (const code of [null, undefined, "", "SOMETHING_NOBODY_SHIPPED"]) {
        expect(mcpErrorMessage(locale, code), String(code)).toBe(generic);
      }
    }
  });
});

/**
 * Every connector this build ships has words in every language.
 *
 * Read off the registry rather than from a list kept here, because a list kept here is a list
 * somebody forgets to extend, and the failure is silent: a lookup that misses falls back to the
 * identifier, so an untranslated connector reaches an operator as `generic-webhook` in the middle
 * of a screen that is otherwise Catalan. That is not hypothetical — it shipped, because the key
 * was written with an underscore and looked up with the hyphen the type actually has.
 *
 * The conversion is asserted here too, so this test fails for the same reason the screen did.
 */
describe("the words for the connectors this build ships", () => {
  const key = (type: string) => type.replace(/-/g, "_");

  it("has a name and a description for every connector, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const type of connectorRegistry.types()) {
        expect(dictionary[`connector_${key(type)}`], `connector_${key(type)} in ${locale}`).toBeTruthy();
        expect(dictionary[`connectorAbout_${key(type)}`], `connectorAbout_${key(type)} in ${locale}`).toBeTruthy();
      }
    }
  });

  /**
   * A field with no wording draws an input labelled with the key its schema uses, which is a form
   * asking for `executionsWindowHours` in a screen that is otherwise in somebody's language.
   */
  it("has a label for every field every connector asks for, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const type of connectorRegistry.types()) {
        for (const field of connectorRegistry.require(type).configFields) {
          const own = dictionary[`field_${key(type)}_${field.name}`];
          expect(own ?? dictionary[`field_${field.name}`], `${type}.${field.name} in ${locale}`).toBeTruthy();
        }
      }
    }
  });

  it("has a name for every kind of credential a connector accepts, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const type of connectorRegistry.types()) {
        for (const kind of connectorRegistry.require(type).credentialKinds) {
          expect(dictionary[`credentialKind_${kind}`], `credentialKind_${kind} in ${locale}`).toBeTruthy();
        }
      }
    }
  });
});

/**
 * Every way a run can fail says what failed, in every language.
 *
 * The vocabulary is closed and lives in `@control-hub/domain`, so this walks it rather than
 * keeping a list here that somebody has to remember to extend. What it guards is a silence: a
 * code with no sentence does not raise anything, it falls back to "the operation could not be
 * completed" — which is what an operator saw when the real answer was that the address they had
 * just typed was not on the allowlist.
 *
 * Hence the second assertion. A key that exists but holds the generic sentence passes a
 * truthiness check and tells the reader exactly as little, so the fallback is banned as a value.
 *
 * These live in their own `runError` namespace on purpose. `FORBIDDEN` from this API means the
 * reader lacks a permission; `FORBIDDEN` from a run means the provider refused us. One key
 * cannot honestly say both.
 */
describe("the words for every way a run can fail", () => {
  const key = (code: string) =>
    [
      "runError",
      ...code
        .toLowerCase()
        .split("_")
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
    ].join("");

  it("has a sentence for every code a failed run can store, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const code of connectorErrorCodes) {
        expect(dictionary[key(code)], `${key(code)} in ${locale}`).toBeTruthy();
      }
    }
  });

  it("never answers with the sentence that says nothing", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const code of connectorErrorCodes) {
        expect(dictionary[key(code)], `${key(code)} in ${locale}`).not.toBe(dictionary.errorUnknown);
      }
    }
  });

  /** A sentence that names a provider names the wrong one for every connector but that provider. */
  it("says what happened without naming anybody's product", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const code of connectorErrorCodes) {
        expect(dictionary[key(code)]!.toLowerCase(), `${key(code)} in ${locale}`).not.toContain("n8n");
      }
    }
  });
});

/**
 * Every way the infrastructure module refuses says which one it was, in every language.
 *
 * The same guarantee the runs already had, and the same reason: increment 7.3 exists because a
 * `404` with no code reached an operator as "the operation could not be completed" while the real
 * answer was that a migration was missing. A code with no sentence is that failure again, so the
 * closed list in `@control-hub/domain` is walked rather than copied, and the generic sentence is
 * banned as a value so that a key which exists but says nothing cannot pass.
 */
describe("the words for every way the infrastructure module refuses", () => {
  const key = (code: string) =>
    [
      "error",
      ...code
        .toLowerCase()
        .split("_")
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
    ].join("");

  it("has a sentence for every code the module can answer with, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
      for (const code of infrastructureErrorCodes) {
        expect(dictionary[key(code)], `${key(code)} in ${locale}`).toBeTruthy();
      }
    }
  });

  it("never answers with the sentence that says nothing", () => {
    for (const locale of locales) {
      const dictionary = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
      for (const code of infrastructureErrorCodes) {
        if (code === "INTERNAL_ERROR") continue;
        expect(dictionary[key(code)], `${key(code)} in ${locale}`).not.toBe(dictionary.errorUnknown);
      }
    }
  });
});

/**
 * The guided check is a chain of rungs, and a rung nobody has words for is a rung the screen
 * cannot draw. Both halves are required of every one of them: the name says which link this is,
 * and the remedy says what to do about it -- a panel that names a broken link and then says
 * nothing about it is the runbook problem again, one screen closer to the person.
 */
describe("the words the guided check is read in", () => {
  const pascal = (step: string) =>
    step
      .split("_")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");

  it("names every rung and says how to mend it, in every locale", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const step of connectorDiagnosisSteps) {
        expect(dictionary[`diagnosisStep${pascal(step)}`], `name of ${step} in ${locale}`).toBeTruthy();
        expect(dictionary[`diagnosisFix${pascal(step)}`], `remedy for ${step} in ${locale}`).toBeTruthy();
      }
    }
  });

  it("has a word for each of the four things a rung can be", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      for (const status of ["Passed", "Failed", "Unknown", "Unchecked"]) {
        expect(dictionary[`diagnosis${status}`], `${status} in ${locale}`).toBeTruthy();
      }
    }
  });

  /**
   * The rung that separates a machine nobody knocked on from a machine that is dead is the one
   * whose words matter most, and it is the only one whose remedy is about spelling rather than
   * about running something. Losing that distinction in translation loses the increment.
   */
  it("tells the tunnel command apart from the sentence about spelling", () => {
    for (const locale of locales) {
      const dictionary = getIntegrationsDictionary(locale) as unknown as Record<string, string>;
      expect(dictionary.diagnosisFixMatching).not.toBe(dictionary.diagnosisFixReachable);
      expect(dictionary.diagnosisTunnelRunsHere, locale).toBeTruthy();
    }
  });
});

import { connectorRegistry } from "@control-hub/connectors";
import { connectorErrorCodes } from "@control-hub/domain";
import { describe, expect, it } from "vitest";
import {
  getAttendanceDictionary,
  getDictionary,
  getInfrastructureDictionary,
  getIntegrationsDictionary,
  locales
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

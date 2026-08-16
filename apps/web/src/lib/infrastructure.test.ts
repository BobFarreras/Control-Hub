import { getInfrastructureDictionary, locales } from "@control-hub/i18n";
import { describe, expect, it } from "vitest";
import type { InfrastructureAlert } from "./api-types";
import { ageLabel, alertState, alertStateTone, readingAge, severityTone, staleAfterMinutes } from "./infrastructure";

const at = (iso: string) => new Date(iso);
const now = at("2026-08-13T12:00:00.000Z");

function alert(overrides: Partial<InfrastructureAlert> = {}): InfrastructureAlert {
  return {
    id: "a-1",
    ruleId: "r-1",
    ruleName: "n8n is quiet",
    dedupKey: "instance:i-1",
    status: "firing",
    severity: "high",
    summary: {},
    startedAt: "2026-08-13T11:00:00.000Z",
    lastSeenAt: "2026-08-13T11:58:00.000Z",
    occurrences: 4,
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedByMembershipId: null,
    incidentId: null,
    ...overrides
  };
}

describe("the age of a reading", () => {
  /**
   * Every observed figure on this screen travels with its age, because the alternative is a
   * number from an hour ago that looks exactly like a number from a second ago.
   */
  it("counts in the largest unit that still says something useful", () => {
    expect(readingAge("2026-08-13T11:59:30.000Z", now)).toMatchObject({ unit: "minute", count: 0 });
    expect(readingAge("2026-08-13T11:53:00.000Z", now)).toMatchObject({ unit: "minute", count: 7 });
    expect(readingAge("2026-08-13T11:01:00.000Z", now)).toMatchObject({ unit: "minute", count: 59 });
    expect(readingAge("2026-08-13T11:00:00.000Z", now)).toMatchObject({ unit: "hour", count: 1 });
    expect(readingAge("2026-08-12T13:00:00.000Z", now)).toMatchObject({ unit: "hour", count: 23 });
    expect(readingAge("2026-08-12T12:00:00.000Z", now)).toMatchObject({ unit: "day", count: 1 });
    expect(readingAge("2026-07-14T12:00:00.000Z", now)).toMatchObject({ unit: "day", count: 30 });
  });

  /**
   * A reading dated after the moment we are drawing it is a clock disagreement, not a reading
   * from the future. It reads as fresh rather than as a negative age.
   */
  it("does not report a negative age when the two clocks disagree", () => {
    expect(readingAge("2026-08-13T12:04:00.000Z", now)).toEqual({ unit: "minute", count: 0, stale: false });
  });

  /**
   * The pull that feeds these rows runs every 15 minutes. Three of them missed is no longer a
   * slow pass: it is a provider we have lost sight of, and the row has to say so on its own.
   */
  it("calls a reading stale once several passes could have gone by without one", () => {
    expect(readingAge("2026-08-13T11:20:00.000Z", now)?.stale).toBe(false);
    expect(readingAge(new Date(now.getTime() - staleAfterMinutes * 60_000).toISOString(), now)?.stale).toBe(true);
    expect(readingAge("2026-08-13T09:00:00.000Z", now)?.stale).toBe(true);
  });

  it("has nothing to say about a reading that is not there", () => {
    expect(readingAge(null, now)).toBeNull();
    expect(readingAge("not a date", now)).toBeNull();
  });
});

describe("what an alert looks like", () => {
  /**
   * Acknowledged is a state of its own and not a shade of firing: somebody is on it, and the
   * screen must stop asking for the same attention it asked for before they said so.
   */
  it("separates a live alert from one somebody has taken", () => {
    expect(alertState(alert())).toBe("firing");
    expect(alertState(alert({ acknowledgedAt: "2026-08-13T11:30:00.000Z" }))).toBe("acknowledged");
    expect(alertState(alert({ status: "resolved", resolvedAt: "2026-08-13T11:40:00.000Z" }))).toBe("resolved");
  });

  /** A resolved alert stays resolved even if it was acknowledged on the way there. */
  it("reads a resolved alert as resolved, whoever acknowledged it first", () => {
    expect(
      alertState(
        alert({
          status: "resolved",
          acknowledgedAt: "2026-08-13T11:30:00.000Z",
          resolvedAt: "2026-08-13T11:40:00.000Z"
        })
      )
    ).toBe("resolved");
  });

  /**
   * Tone is never the only carrier of meaning here either: `StatusPill` draws the word and an
   * icon beside it, so a severity is legible without seeing the colour.
   */
  it("gives every severity and every state a tone, so none renders untoned", () => {
    expect(Object.values(severityTone).every(Boolean)).toBe(true);
    expect(Object.values(alertStateTone).every(Boolean)).toBe(true);
    expect(severityTone.critical).toBe("danger");
    expect(alertStateTone.resolved).toBe("done");
  });
});

describe("an age in words", () => {
  const labels = getInfrastructureDictionary("ca") as unknown as Record<string, string>;

  it("reads a fresh reading as a word rather than as a zero", () => {
    expect(ageLabel(labels, readingAge("2026-08-13T11:59:40.000Z", now), "-")).toBe(labels.ageNow);
  });

  it("puts the count into the sentence of each unit", () => {
    expect(ageLabel(labels, readingAge("2026-08-13T11:53:00.000Z", now), "-")).toContain("7");
    expect(ageLabel(labels, readingAge("2026-08-13T09:00:00.000Z", now), "-")).toContain("3");
    expect(ageLabel(labels, readingAge("2026-08-10T12:00:00.000Z", now), "-")).toContain("3");
  });

  /** An age we do not have is never drawn as an age of zero. */
  it("hands back the caller's fallback when there is no reading", () => {
    expect(ageLabel(labels, null, "no reading")).toBe("no reading");
  });

  it("leaves no placeholder on screen, in any language", () => {
    for (const locale of locales) {
      const dictionary = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
      for (const iso of ["2026-08-13T11:53:00.000Z", "2026-08-13T09:00:00.000Z", "2026-08-10T12:00:00.000Z"]) {
        expect(ageLabel(dictionary, readingAge(iso, now), "-"), locale).not.toContain("{count}");
      }
    }
  });
});

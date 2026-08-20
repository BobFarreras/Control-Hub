import { getInfrastructureDictionary, locales } from "@control-hub/i18n";
import { describe, expect, it } from "vitest";
import type { InfrastructureAlert, Reading, ReadingValue } from "./api-types";
import {
  ageLabel,
  alertState,
  alertStateTone,
  observedStateTone,
  readingAge,
  readingFigures,
  severityTone,
  staleAfterMinutes
} from "./infrastructure";

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

describe("what a machine currently looks like", () => {
  const labels = getInfrastructureDictionary("ca") as unknown as Record<string, string>;
  const reading = (data: Record<string, ReadingValue>): Reading => ({
    state: "up",
    observedAt: "2026-08-13T11:58:00.000Z",
    data
  });
  const shown = (data: Record<string, ReadingValue>) => readingFigures(labels, "ca", reading(data), now);

  /**
   * `unknown` is the third answer and not a shade of `down`. A collector we have lost sight of
   * drawn in the colour of an outage is an outage of the screen's own making, and somebody would
   * go looking for a machine that never stopped.
   */
  it("gives every state a tone, and never draws unknown as down", () => {
    expect(Object.values(observedStateTone).every(Boolean)).toBe(true);
    expect(observedStateTone.up).toBe("active");
    expect(observedStateTone.down).toBe("danger");
    expect(observedStateTone.unknown).toBe("neutral");
    expect(observedStateTone.unknown).not.toBe(observedStateTone.down);
  });

  /** The order is the table's and not the payload's, so two machines read the same way. */
  it("reads the figures of a host in one order, whatever order they arrived in", () => {
    const figures = shown({ load1: 0.74, uptimeSeconds: 1_036_800, cpuBusyRatio: 0.37, memoryUsedRatio: 0.62 });
    expect(figures.map((figure) => figure.label)).toEqual([
      labels.figureCpu,
      labels.figureMemory,
      labels.figureLoad,
      labels.figureUptime
    ]);
  });

  it("turns a ratio into a percentage and a count of bytes into something a person reads", () => {
    expect(shown({ cpuBusyRatio: 0.3712 })[0]?.value).toBe("37%");
    expect(shown({ filesystemUsedRatio: 1 })[0]?.value).toBe("100%");
    expect(shown({ memoryBytes: 2_147_483_648 })[0]?.value).toBe("2,1 GB");
    expect(shown({ load1: 0.74 })[0]?.value).toBe("0,74");
    expect(shown({ durationSeconds: 0.1834 })[0]?.value).toBe("183 ms");
  });

  it("says how long a machine has been up and how long a certificate has left", () => {
    expect(shown({ uptimeSeconds: 1_036_800 })[0]?.value).toBe(labels.ageDays!.replace("{count}", "12"));
    expect(shown({ uptimeSeconds: 7_200 })[0]?.value).toBe(labels.ageHours!.replace("{count}", "2"));
    expect(shown({ certificateExpiresAt: "2026-09-15T12:00:00.000Z" })[0]?.value).toBe(
      labels.figureRemainingDays!.replace("{count}", "33")
    );
  });

  /** A certificate that is already gone says so in words: a negative count of days is not a fact. */
  it("says a certificate has expired rather than counting backwards", () => {
    expect(shown({ certificateExpiresAt: "2026-08-01T12:00:00.000Z" })[0]?.value).toBe(labels.figureExpired);
  });

  /** The age of a container's start is an age like any other, and reads as one. */
  it("dates a container by when it started, not by a timestamp nobody can subtract", () => {
    expect(shown({ startedAt: "2026-08-13T09:00:00.000Z" })[0]?.value).toBe(labels.ageHours!.replace("{count}", "3"));
  });

  /**
   * The API already names field by field what may leave it. This is the same rule on the side of
   * the wire the browser is on: a field nobody put in the table is not drawn, so a collector that
   * starts publishing an address reaches nobody by the mere fact of existing.
   */
  it("keeps quiet about a field it has no words for", () => {
    const figures = shown({ scrapeUrl: "http://example.invalid/metrics", apiToken: "t", cpuBusyRatio: 0.1 });
    expect(figures).toHaveLength(1);
    expect(JSON.stringify(figures)).not.toContain("example.invalid");
  });

  it("has nothing to show for a reading nobody has taken", () => {
    expect(shown({})).toEqual([]);
  });

  /** A field of the wrong shape is a provider we misread, and a figure is worse than none. */
  it("does not turn a value of the wrong type into a figure", () => {
    expect(shown({ cpuBusyRatio: "high" })).toEqual([]);
    expect(shown({ uptimeSeconds: null })).toEqual([]);
    expect(shown({ startedAt: 17 })).toEqual([]);
    expect(shown({ certificateExpiresAt: "not a date" })).toEqual([]);
  });

  it("leaves no placeholder and no empty word on screen, in any language", () => {
    const data = {
      cpuBusyRatio: 0.37,
      memoryUsedRatio: 0.62,
      filesystemUsedRatio: 0.81,
      load1: 0.74,
      uptimeSeconds: 1_036_800,
      memoryBytes: 2_147_483_648,
      cpuCores: 0.0421,
      startedAt: "2026-08-10T12:00:00.000Z",
      durationSeconds: 0.1834,
      certificateExpiresAt: "2026-09-15T12:00:00.000Z",
      lastSuccessAt: "2026-08-13T04:00:00.000Z"
    };
    for (const locale of locales) {
      const dictionary = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
      const figures = readingFigures(dictionary, locale, reading(data), now);
      expect(figures, locale).toHaveLength(Object.keys(data).length);
      for (const figure of figures) {
        expect(figure.label, `${locale} ${figure.value}`).toBeTruthy();
        expect(figure.value, `${locale} ${figure.label}`).toBeTruthy();
        expect(`${figure.label}${figure.value}`, locale).not.toContain("{count}");
      }
    }
  });
});

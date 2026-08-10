import { describe, expect, it } from "vitest";
import {
  canTransitionTicket,
  deriveInboxSlaStatus,
  estimateDeadline,
  inboxSlaInfo,
  slaState,
  ticketStatuses,
  type SupportCalendar
} from "./index.js";

const officeHours: SupportCalendar = {
  timeZone: "Europe/Madrid",
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "16:00" })),
  holidays: []
};
const at = (iso: string) => new Date(iso);

/** Tuesday 2026-08-04, 09:00 Madrid. August is UTC+2. */
const openedAt = at("2026-08-04T07:00:00Z");
const targets = { firstResponseTargetMinutes: 60, resolutionTargetMinutes: 240 };

describe("ticket transitions", () => {
  it("moves through the working states", () => {
    expect(canTransitionTicket("new", "open")).toBe(true);
    expect(canTransitionTicket("open", "waiting_customer")).toBe(true);
    expect(canTransitionTicket("waiting_customer", "open")).toBe(true);
    expect(canTransitionTicket("open", "resolved")).toBe(true);
    expect(canTransitionTicket("resolved", "closed")).toBe(true);
  });

  it("allows reopening a resolved ticket but never a closed one", () => {
    expect(canTransitionTicket("resolved", "open")).toBe(true);
    for (const status of ticketStatuses) expect(canTransitionTicket("closed", status)).toBe(false);
  });

  it("refuses a move to the state it is already in", () => {
    for (const status of ticketStatuses) expect(canTransitionTicket(status, status)).toBe(false);
  });

  it("refuses skipping straight from waiting to resolved", () => {
    // The answer arrived or it did not; going back to open first is what records that.
    expect(canTransitionTicket("waiting_customer", "resolved")).toBe(false);
  });
});

describe("sla state", () => {
  const state = (input: Partial<Parameters<typeof slaState>[0]> = {}) =>
    slaState({ calendar: officeHours, openedAt, now: at("2026-08-04T08:00:00Z"), pauses: [], ...targets, ...input });

  it("counts the working minutes elapsed so far", () => {
    // 09:00 to 10:00 Madrid.
    expect(state().firstResponse.consumedMinutes).toBe(60);
  });

  it("stops counting the first response once it has been given", () => {
    const given = state({ firstResponseAt: at("2026-08-04T07:30:00Z"), now: at("2026-08-05T14:00:00Z") });
    expect(given.firstResponse.consumedMinutes).toBe(30);
    expect(given.firstResponse.breached).toBe(false);
  });

  it("reports a breach when the target is passed", () => {
    const late = state({ firstResponseAt: at("2026-08-04T09:00:00Z") });
    expect(late.firstResponse.consumedMinutes).toBe(120);
    expect(late.firstResponse.breached).toBe(true);
  });

  it("does not count the time spent waiting on somebody else", () => {
    // Waited from 09:30 to 11:30 Madrid, so only 30 minutes of the two hours count.
    const waited = state({
      now: at("2026-08-04T09:30:00Z"),
      pauses: [{ from: at("2026-08-04T07:30:00Z"), to: at("2026-08-04T09:30:00Z") }]
    });
    expect(waited.firstResponse.consumedMinutes).toBe(30);
    expect(waited.firstResponse.breached).toBe(false);
  });

  it("treats a pause that is still open as lasting until now", () => {
    const waiting = state({
      now: at("2026-08-04T09:30:00Z"),
      pauses: [{ from: at("2026-08-04T07:30:00Z"), to: null }]
    });
    expect(waiting.firstResponse.consumedMinutes).toBe(30);
  });

  it("only counts the working part of a pause, not its wall clock length", () => {
    // Opened Friday 15:00, paused Friday 15:30 to Monday 08:00, measured Monday 09:00.
    // The pause spans 64 hours of wall clock but only 30 working minutes, all on the Friday:
    // the weekend was never counting, so pausing over it subtracts nothing.
    const overWeekend = state({
      openedAt: at("2026-08-07T13:00:00Z"),
      now: at("2026-08-10T07:00:00Z"),
      pauses: [{ from: at("2026-08-07T13:30:00Z"), to: at("2026-08-10T06:00:00Z") }]
    });
    // Friday 15:00-15:30 plus Monday 08:00-09:00, with Friday 15:30-16:00 subtracted.
    expect(overWeekend.firstResponse.consumedMinutes).toBe(90);
  });

  it("measures resolution against its own target and stops when resolved", () => {
    const resolved = state({
      firstResponseAt: at("2026-08-04T07:30:00Z"),
      resolvedAt: at("2026-08-04T11:00:00Z"),
      now: at("2026-08-06T10:00:00Z")
    });
    expect(resolved.resolution.consumedMinutes).toBe(240);
    expect(resolved.resolution.breached).toBe(false);
    expect(resolved.resolution.targetMinutes).toBe(240);
  });

  it("keeps counting resolution while the ticket is open", () => {
    const open = state({ now: at("2026-08-04T12:00:00Z") });
    expect(open.resolution.consumedMinutes).toBe(300);
    expect(open.resolution.breached).toBe(true);
  });

  it("reports no measurement when the calendar has no working window", () => {
    const unconfigured = state({ calendar: { timeZone: "Europe/Madrid", windows: [], holidays: [] } });
    // Not zero: an absent schedule and an instant reply must not look the same.
    expect(unconfigured.firstResponse.measurable).toBe(false);
    expect(unconfigured.firstResponse.breached).toBe(false);
  });
});

describe("deriveInboxSlaStatus", () => {
  it("returns not_configured when not measurable", () => {
    expect(deriveInboxSlaStatus(0, 60, false, false, false)).toBe("not_configured");
  });

  it("returns paused when the clock is stopped", () => {
    expect(deriveInboxSlaStatus(30, 60, true, false, true)).toBe("paused");
  });

  it("returns breached when the target is exceeded", () => {
    expect(deriveInboxSlaStatus(70, 60, true, true, false)).toBe("breached");
  });

  it("returns near when consumed is >= 80% of target", () => {
    expect(deriveInboxSlaStatus(48, 60, true, false, false)).toBe("near");
    expect(deriveInboxSlaStatus(60, 60, true, false, false)).toBe("near");
  });

  it("returns on_time when consumed is < 80% of target", () => {
    expect(deriveInboxSlaStatus(30, 60, true, false, false)).toBe("on_time");
  });

  it("breached takes priority over near", () => {
    expect(deriveInboxSlaStatus(70, 60, true, true, false)).toBe("breached");
  });

  it("paused takes priority over breached", () => {
    expect(deriveInboxSlaStatus(70, 60, true, true, true)).toBe("paused");
  });
});

describe("estimateDeadline", () => {
  it("returns null when not measurable", () => {
    expect(estimateDeadline(30, 60, false, false, openedAt, at("2026-08-04T08:00:00Z"), [])).toBeNull();
  });

  it("returns null when already breached", () => {
    expect(estimateDeadline(70, 60, true, true, openedAt, at("2026-08-04T08:00:00Z"), [])).toBeNull();
  });

  it("returns null when consumed is zero (no rate to extrapolate)", () => {
    expect(estimateDeadline(0, 60, true, false, openedAt, at("2026-08-04T08:00:00Z"), [])).toBeNull();
  });

  it("estimates a deadline based on the current consumption rate", () => {
    // Opened at 07:00 UTC (09:00 Madrid), now 08:00 UTC (10:00 Madrid).
    // 60 working minutes consumed, target is 120 → need 60 more.
    // Rate is 60 min per 60 wall-clock min → deadline at now + 60 min = 09:00 UTC.
    const deadline = estimateDeadline(60, 120, true, false, at("2026-08-04T07:00:00Z"), at("2026-08-04T08:00:00Z"), []);
    expect(deadline).toBe(at("2026-08-04T09:00:00Z").toISOString());
  });

  it("accounts for open pauses when estimating", () => {
    // Same as above but with a 30-min open pause: effective wall = 30 min.
    // Rate = 60 / 30 = 2 min/min → 60 remaining at 2 min/min → 30 min.
    const deadline = estimateDeadline(60, 120, true, false, at("2026-08-04T07:00:00Z"), at("2026-08-04T08:00:00Z"), [
      { from: at("2026-08-04T07:30:00Z"), to: null }
    ]);
    expect(deadline).toBe(at("2026-08-04T08:30:00Z").toISOString());
  });
});

describe("inboxSlaInfo", () => {
  const base = { calendar: officeHours, openedAt, now: at("2026-08-04T08:00:00Z"), pauses: [] as const };
  const measurable = { measurable: true, breached: false };

  it("derives the correct active target when first response is pending", () => {
    const info = inboxSlaInfo(
      { ...measurable, consumedMinutes: 30, targetMinutes: 60 },
      { ...measurable, consumedMinutes: 60, targetMinutes: 240 },
      undefined,
      undefined,
      base.openedAt,
      base.now,
      base.pauses
    );
    expect(info.firstResponse.activeTarget).toBe("first_response");
    expect(info.resolution.activeTarget).toBe("resolution");
  });

  it("returns null estimatedDeadline when first response is already given", () => {
    const info = inboxSlaInfo(
      { ...measurable, consumedMinutes: 30, targetMinutes: 60 },
      { ...measurable, consumedMinutes: 60, targetMinutes: 240 },
      at("2026-08-04T07:30:00Z"),
      undefined,
      base.openedAt,
      base.now,
      base.pauses
    );
    expect(info.firstResponse.estimatedDeadline).toBeNull();
  });

  it("detects paused state from an open pause", () => {
    const info = inboxSlaInfo(
      { ...measurable, consumedMinutes: 30, targetMinutes: 60 },
      { ...measurable, consumedMinutes: 60, targetMinutes: 240 },
      undefined,
      undefined,
      base.openedAt,
      base.now,
      [{ from: at("2026-08-04T07:30:00Z"), to: null }]
    );
    expect(info.firstResponse.status).toBe("paused");
    expect(info.resolution.status).toBe("paused");
  });
});

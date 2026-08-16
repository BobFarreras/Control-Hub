import { describe, expect, it } from "vitest";
import { alertRetention, purgeResolvedAlerts } from "./purge.js";

const logger = () => {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  return {
    lines,
    info: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }),
    warn: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message })
  };
};

describe("ageing out resolved alerts", () => {
  it("asks for the window in days, counted back from the moment of the pass", async () => {
    let asked: { resolvedBefore: Date; batchLimit: number } | null = null;
    const now = new Date("2026-08-13T12:00:00.000Z");

    await purgeResolvedAlerts(
      {
        purgeAlertEvents: (input) => {
          asked = input;
          return Promise.resolve(0);
        }
      },
      logger(),
      now
    );

    expect(asked).toEqual({
      resolvedBefore: new Date("2026-02-14T12:00:00.000Z"),
      batchLimit: alertRetention.batchLimit
    });
  });

  it("says nothing when there was nothing to remove, which is most hours", async () => {
    const log = logger();
    await purgeResolvedAlerts({ purgeAlertEvents: () => Promise.resolve(0) }, log, new Date());
    expect(log.lines).toEqual([]);
  });

  it("reports what it removed when it removed something", async () => {
    const log = logger();
    const purged = await purgeResolvedAlerts({ purgeAlertEvents: () => Promise.resolve(12) }, log, new Date());

    expect(purged).toBe(12);
    expect(log.lines).toEqual([{ fields: { purged: 12 }, message: "expired alert events removed" }]);
  });
});

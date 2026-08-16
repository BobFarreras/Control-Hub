import type { ConnectorRepository, PurgeRecordsInput } from "@control-hub/application";
import { describe, expect, it, vi } from "vitest";
import { purgeConnectorRecords, recordRetention } from "./purge.js";

const logger = { info: vi.fn(), warn: vi.fn() };

function repositoryReturning(result: { purged: number; trimmed: number }) {
  const calls: PurgeRecordsInput[] = [];
  const repository = {
    purgeRecords: (input: PurgeRecordsInput) => {
      calls.push(input);
      return Promise.resolve(result);
    }
  } as unknown as ConnectorRepository;
  return { repository, calls };
}

const now = new Date("2026-08-12T00:00:00.000Z");

describe("purging what connectors pulled", () => {
  it("expires the two shapes on their own clocks", async () => {
    const { repository, calls } = repositoryReturning({ purged: 3, trimmed: 0 });
    await purgeConnectorRecords(repository, logger, now);

    expect(calls[0]?.stateBefore).toEqual(new Date("2026-07-13T00:00:00.000Z"));
    expect(calls[0]?.eventBefore).toEqual(new Date("2026-05-14T00:00:00.000Z"));
  });

  it("bounds the pass, so retention cannot lock a table somebody is reading", async () => {
    const { repository, calls } = repositoryReturning({ purged: 0, trimmed: 0 });
    await purgeConnectorRecords(repository, logger, now);

    expect(calls[0]?.batchLimit).toBe(recordRetention.batchLimit);
    expect(calls[0]?.batchLimit).toBeGreaterThan(0);
    expect(calls[0]?.maxPerOperation).toBe(recordRetention.maxPerOperation);
  });

  it("says nothing when there was nothing to remove", async () => {
    const { repository } = repositoryReturning({ purged: 0, trimmed: 0 });
    vi.clearAllMocks();
    await purgeConnectorRecords(repository, logger, now);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns when the ceiling was hit, because that is a provider we misread", async () => {
    const { repository } = repositoryReturning({ purged: 0, trimmed: 12 });
    vi.clearAllMocks();
    await purgeConnectorRecords(repository, logger, now);

    // Routine expiry is noise; the ceiling is the one that has to be noticed before the rows
    // being dropped are the ones somebody needed.
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ trimmed: 12 }), "RECORDS_TRIMMED");
  });
});

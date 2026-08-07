import type { Permission, TenantContext } from "@control-hub/domain";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectsService,
  valueEntries,
  type ProfitabilityInput,
  type ProjectRecord,
  type ProjectsRepository,
  type TimeEntryRecord
} from "./projects.js";

const context = (permissions: Permission[], membershipId = "member-a"): TenantContext => ({
  tenantId: "tenant",
  membershipId,
  userId: "user",
  roles: ["administrator"],
  permissions,
  mfaEnabled: true
});

const manager = context(["projects:manage", "time:log", "time:manage", "financials:read"]);
const technical = context(["projects:manage", "time:log"], "member-b");

const project = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: "project-1",
  customerId: "customer-1",
  serviceTypeId: null,
  code: "web-nova",
  name: "Web nova",
  description: null,
  status: "active",
  ownerMembershipId: null,
  startedAt: null,
  dueAt: null,
  closedAt: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides
});

const entry = (overrides: Partial<TimeEntryRecord> = {}): TimeEntryRecord => ({
  id: "entry-1",
  membershipId: "member-a",
  projectId: "project-1",
  ticketId: null,
  spentOn: "2026-08-04",
  minutes: 90,
  billable: true,
  note: null,
  createdAt: new Date("2026-08-04T10:00:00Z"),
  ...overrides
});

const repository = (overrides: Partial<ProjectsRepository> = {}): ProjectsRepository => ({
  listProjects: vi.fn<ProjectsRepository["listProjects"]>().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 25
  }),
  createProject: vi.fn<ProjectsRepository["createProject"]>().mockResolvedValue(project()),
  getProject: vi.fn<ProjectsRepository["getProject"]>().mockResolvedValue(project()),
  getProjectDetail: vi.fn<ProjectsRepository["getProjectDetail"]>().mockResolvedValue({
    project: { ...project(), customerName: "Client A", ownerName: null, serviceTypeName: null, loggedMinutes: 0 },
    events: [],
    assignableMembers: []
  }),
  updateProjectStatus: vi
    .fn<ProjectsRepository["updateProjectStatus"]>()
    .mockResolvedValue(project({ status: "closed" })),
  updateProjectServiceType: vi
    .fn<ProjectsRepository["updateProjectServiceType"]>()
    .mockImplementation((_context, _id, serviceTypeId) => Promise.resolve(project({ serviceTypeId }))),
  listServiceTypes: vi.fn<ProjectsRepository["listServiceTypes"]>().mockResolvedValue([]),
  createServiceType: vi
    .fn<ProjectsRepository["createServiceType"]>()
    .mockImplementation((_context, input) =>
      Promise.resolve({ id: "type-1", ...input, active: true, projectCount: 0, rateCount: 0 })
    ),
  deleteServiceType: vi.fn<ProjectsRepository["deleteServiceType"]>().mockResolvedValue({ detachedProjects: 0 }),
  setServiceTypeActive: vi.fn<ProjectsRepository["setServiceTypeActive"]>().mockResolvedValue(null),
  annulCostRate: vi.fn<ProjectsRepository["annulCostRate"]>().mockResolvedValue(null),
  annulBillingRate: vi.fn<ProjectsRepository["annulBillingRate"]>().mockResolvedValue(null),
  listTimeEntries: vi
    .fn<ProjectsRepository["listTimeEntries"]>()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
  getTimeEntry: vi.fn<ProjectsRepository["getTimeEntry"]>().mockResolvedValue(entry()),
  findTimeEntryByClientReference: vi.fn<ProjectsRepository["findTimeEntryByClientReference"]>().mockResolvedValue(null),
  createTimeEntry: vi
    .fn<ProjectsRepository["createTimeEntry"]>()
    .mockImplementation((_context, input) => Promise.resolve(entry(input))),
  updateTimeEntry: vi
    .fn<ProjectsRepository["updateTimeEntry"]>()
    .mockImplementation((_context, _id, changes) => Promise.resolve(entry(changes))),
  deleteTimeEntry: vi.fn<ProjectsRepository["deleteTimeEntry"]>().mockResolvedValue(undefined),
  listCostRates: vi.fn<ProjectsRepository["listCostRates"]>().mockResolvedValue([]),
  listBillingRates: vi.fn<ProjectsRepository["listBillingRates"]>().mockResolvedValue([]),
  publishCostRate: vi.fn<ProjectsRepository["publishCostRate"]>().mockImplementation((_context, input) =>
    Promise.resolve({
      id: "rate-1",
      membershipId: input.membershipId,
      memberName: "Ana",
      currency: input.currency,
      costMinorPerHour: input.costMinorPerHour,
      effectiveFrom: input.effectiveFrom,
      annulledAt: null,
      annulledByName: null
    })
  ),
  publishBillingRate: vi.fn<ProjectsRepository["publishBillingRate"]>().mockImplementation((_context, input) =>
    Promise.resolve({
      id: "rate-2",
      scope: input.scope,
      scopeId: input.scopeId,
      scopeName: "Client A",
      currency: input.currency,
      amountMinorPerHour: input.amountMinorPerHour,
      effectiveFrom: input.effectiveFrom,
      annulledAt: null,
      annulledByName: null
    })
  ),
  loadProjectProfitability: vi.fn<ProjectsRepository["loadProjectProfitability"]>().mockResolvedValue({
    entries: [
      {
        membershipId: "member-a",
        projectId: "project-1",
        serviceTypeId: null,
        spentOn: "2026-08-04",
        minutes: 60,
        billable: true
      }
    ],
    costRates: { "member-a": [{ currency: "EUR", minorPerHour: 2000, effectiveFrom: "2026-01-01" }] },
    projectRates: { "project-1": [{ currency: "EUR", minorPerHour: 6000, effectiveFrom: "2026-01-01" }] },
    customerRates: [],
    serviceTypeRates: {}
  }),
  loadCustomerProfitability: vi.fn<ProjectsRepository["loadCustomerProfitability"]>().mockResolvedValue({
    entries: [],
    costRates: {},
    projectRates: {},
    customerRates: [],
    serviceTypeRates: {}
  }),
  ...overrides
});

const now = new Date("2026-08-05T09:00:00Z");

describe("projects", () => {
  it("refuses a code that is not a stable slug", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.createProject(manager, { customerId: "customer-1", code: "Web Nova", name: "Web nova" })
    ).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("refuses a due date before the start", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.createProject(manager, {
        customerId: "customer-1",
        code: "web-nova",
        name: "Web nova",
        startedAt: new Date("2026-09-01T00:00:00Z"),
        dueAt: new Date("2026-08-01T00:00:00Z")
      })
    ).rejects.toMatchObject({ code: "INVALID_DATES" });
  });

  it("refuses a transition the domain does not allow", async () => {
    const service = new ProjectsService(
      repository({ getProject: vi.fn().mockResolvedValue(project({ status: "canceled" })) })
    );
    await expect(service.changeStatus(manager, "project-1", "active")).rejects.toMatchObject({
      code: "INVALID_TRANSITION"
    });
  });

  it("reports a project that is not there rather than inventing one", async () => {
    const service = new ProjectsService(repository({ getProject: vi.fn().mockResolvedValue(null) }));
    await expect(service.changeStatus(manager, "missing", "active")).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND"
    });
  });
});

describe("logging time", () => {
  it("accepts a written duration and defaults to today", async () => {
    const repo = repository();
    const service = new ProjectsService(repo);
    await service.logTime(manager, { projectId: "project-1", duration: "1h 30m" }, now);
    expect(repo.createTimeEntry).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ minutes: 90, spentOn: "2026-08-05", billable: true })
    );
  });

  it("refuses an entry against both a project and a ticket, or against neither", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.logTime(manager, { projectId: "project-1", ticketId: "ticket-1", duration: "60" }, now)
    ).rejects.toMatchObject({ code: "ENTRY_TARGET_REQUIRED" });
    await expect(service.logTime(manager, { duration: "60" }, now)).rejects.toMatchObject({
      code: "ENTRY_TARGET_REQUIRED"
    });
  });

  it("refuses a day that has not happened yet", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.logTime(manager, { projectId: "project-1", duration: "60", spentOn: "2026-08-06" }, now)
    ).rejects.toMatchObject({ code: "FUTURE_DATE" });
  });

  it("accepts a day in the past", async () => {
    const service = new ProjectsService(repository());
    const logged = await service.logTime(
      manager,
      { projectId: "project-1", duration: "60", spentOn: "2026-07-30" },
      now
    );
    expect(logged.spentOn).toBe("2026-07-30");
  });

  it("refuses hours on a closed project", async () => {
    const service = new ProjectsService(
      repository({ getProject: vi.fn().mockResolvedValue(project({ status: "closed" })) })
    );
    await expect(service.logTime(manager, { projectId: "project-1", duration: "60" }, now)).rejects.toMatchObject({
      code: "PROJECT_CLOSED"
    });
  });

  it("refuses a duration it cannot read", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.logTime(manager, { projectId: "project-1", duration: "una estona" }, now)
    ).rejects.toMatchObject({ code: "INVALID_DURATION" });
  });

  it("returns the stored entry when a client reference repeats", async () => {
    const stored = entry({ id: "entry-existing" });
    const repo = repository({ findTimeEntryByClientReference: vi.fn().mockResolvedValue(stored) });
    const service = new ProjectsService(repo);

    const again = await service.logTime(
      manager,
      { projectId: "project-1", duration: "60", clientReference: "retry-1" },
      now
    );
    expect(again.id).toBe("entry-existing");
    expect(repo.createTimeEntry).not.toHaveBeenCalled();
  });
});

describe("editing somebody else's hours", () => {
  it("lets a member edit their own entry with time:log alone", async () => {
    const repo = repository({ getTimeEntry: vi.fn().mockResolvedValue(entry({ membershipId: "member-b" })) });
    const service = new ProjectsService(repo);
    await expect(service.updateTimeEntry(technical, "entry-1", { duration: "30" }, now)).resolves.toMatchObject({
      entry: { minutes: 30 },
      previous: { minutes: 90 }
    });
  });

  it("refuses to let time:log touch an entry of another person", async () => {
    const service = new ProjectsService(repository({ getTimeEntry: vi.fn().mockResolvedValue(entry()) }));
    await expect(service.updateTimeEntry(technical, "entry-1", { duration: "30" }, now)).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(service.deleteTimeEntry(technical, "entry-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("allows time:manage to correct an entry of another person", async () => {
    const service = new ProjectsService(repository({ getTimeEntry: vi.fn().mockResolvedValue(entry()) }));
    const result = await service.updateTimeEntry(manager, "entry-1", { billable: false }, now);
    expect(result.entry.billable).toBe(false);
  });

  it("hands back the entry as it was, so the audit record can carry the old value", async () => {
    const service = new ProjectsService(repository());
    expect(await service.deleteTimeEntry(manager, "entry-1")).toMatchObject({ minutes: 90, spentOn: "2026-08-04" });
  });
});

describe("rates and margin", () => {
  it("keeps cost away from anybody without financials:read", async () => {
    const service = new ProjectsService(repository());
    await expect(service.listRates(technical)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(service.projectProfitability(technical, "project-1")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(service.customerProfitability(technical, "customer-1")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("defaults an effective date to today rather than to the beginning of time", async () => {
    const repo = repository();
    const service = new ProjectsService(repo);
    await service.publishCostRate(manager, { membershipId: "member-a", currency: "EUR", costMinorPerHour: 2500 }, now);
    expect(repo.publishCostRate).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ effectiveFrom: "2026-08-05" })
    );
  });

  it("refuses a currency that is not ISO 4217", async () => {
    const service = new ProjectsService(repository());
    await expect(
      service.publishCostRate(manager, { membershipId: "member-a", currency: "eur", costMinorPerHour: 2500 }, now)
    ).rejects.toMatchObject({ code: "INVALID_CURRENCY" });
  });

  it("computes the margin of a project from the rates in force", async () => {
    const service = new ProjectsService(repository());
    const report = await service.projectProfitability(manager, "project-1");
    expect(report).toMatchObject({ scope: "project", scopeId: "project-1", minutes: 60 });
    expect(report.lines[0]).toMatchObject({ currency: "EUR", revenueMinor: 6000, costMinor: 2000, marginMinor: 4000 });
  });
});

describe("rate matching", () => {
  const input: ProfitabilityInput = {
    entries: [
      {
        membershipId: "member-a",
        projectId: "project-1",
        serviceTypeId: "web",
        spentOn: "2026-07-15",
        minutes: 60,
        billable: true
      },
      {
        membershipId: "member-a",
        projectId: null,
        serviceTypeId: "web",
        spentOn: "2026-07-15",
        minutes: 60,
        billable: true
      },
      // A project of a known kind of work, with no rate of its own and no customer rate: the only
      // thing left to price it with is the standing rate for that kind of work.
      {
        membershipId: "member-a",
        projectId: "project-2",
        serviceTypeId: "ai-agent",
        spentOn: "2026-07-15",
        minutes: 60,
        billable: true
      },
      // Neither a rate of its own nor a kind of work: nothing can price this, and that has to stay
      // visible rather than quietly resolve to zero.
      {
        membershipId: "member-a",
        projectId: "project-3",
        serviceTypeId: null,
        spentOn: "2026-07-15",
        minutes: 60,
        billable: true
      }
    ],
    costRates: {
      "member-a": [
        { currency: "EUR", minorPerHour: 2000, effectiveFrom: "2026-01-01" },
        { currency: "EUR", minorPerHour: 3000, effectiveFrom: "2026-08-01" }
      ]
    },
    projectRates: { "project-1": [{ currency: "EUR", minorPerHour: 9000, effectiveFrom: "2026-01-01" }] },
    customerRates: [{ currency: "EUR", minorPerHour: 6000, effectiveFrom: "2026-01-01" }],
    serviceTypeRates: {
      web: [{ currency: "EUR", minorPerHour: 7000, effectiveFrom: "2026-01-01" }],
      "ai-agent": [{ currency: "EUR", minorPerHour: 12_000, effectiveFrom: "2026-01-01" }]
    }
  };

  it("values work with the rate of the day it was done, not today's", () => {
    expect(valueEntries(input)[0]!.cost).toEqual({ currency: "EUR", minorPerHour: 2000 });
  });

  it("prefers the rate of the project over the one of its customer", () => {
    expect(valueEntries(input)[0]!.revenue).toEqual({ currency: "EUR", minorPerHour: 9000 });
  });

  it("falls back to the customer rate for time logged against a ticket", () => {
    expect(valueEntries(input)[1]!.revenue).toEqual({ currency: "EUR", minorPerHour: 6000 });
  });

  it("falls back to the rate of the kind of work when neither the project nor the customer has one", () => {
    expect(valueEntries({ ...input, customerRates: [] })[2]!.revenue).toEqual({
      currency: "EUR",
      minorPerHour: 12_000
    });
  });

  it("prefers the customer rate over the one for the kind of work", () => {
    // 6000 is the customer's and 7000 the one for web work: the more specific of the two wins.
    expect(valueEntries(input)[1]!.revenue).toEqual({ currency: "EUR", minorPerHour: 6000 });
  });

  it("leaves an entry unpriced when nothing resolves, instead of valuing it at zero", () => {
    expect(valueEntries({ ...input, customerRates: [] })[3]!.revenue).toBeNull();
  });

  it("leaves the rate absent when none was ever published", () => {
    // Every group emptied, including the one for the kind of work: with three places a sale price
    // can come from, clearing two of them is no longer "none was published".
    const valued = valueEntries({
      ...input,
      costRates: {},
      projectRates: {},
      customerRates: [],
      serviceTypeRates: {}
    });
    expect(valued[0]!.cost).toBeNull();
    expect(valued[0]!.revenue).toBeNull();
  });
});

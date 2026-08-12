import type { RegisteredConnector } from "@control-hub/connectors";
import { rolePermissions, type Permission, type RoleCode, type TenantContext } from "@control-hub/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorService, ConnectorServiceError, type ConnectorHealthCheckQueue } from "./connector-instances.js";
import type {
  ConnectorConfig,
  ConnectorInstanceRecord,
  ConnectorRepository,
  CreateInstanceInput,
  RunPage
} from "./connectors.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const instanceId = "33333333-3333-4333-8333-333333333333";
const missingInstanceId = "44444444-4444-4444-8444-444444444444";

/**
 * The real matrix, read from the domain rather than typed out again here.
 *
 * Acceptance criterion 7 is about what a role can do, so a test that invented its own permission
 * list would pass while the product's own roles said something else.
 */
function asRole(role: RoleCode, overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId,
    membershipId: "m-1",
    userId: "u-1",
    roles: [role],
    permissions: [...rolePermissions[role]] as Permission[],
    mfaEnabled: true,
    ...overrides
  };
}

const owner = asRole("owner");
const administrator = asRole("administrator");
const technical = asRole("technical");

/** A connector whose schema accepts one optional https URL and nothing else. */
const demo = {
  type: "demo",
  contractVersion: 1,
  credentialKinds: ["api_key"],
  capabilities: { egress: { schemes: ["https"], destination: "configured_base_url" }, operations: ["pull"], ingress: false },
  ingressSignature: null,
  parseConfig: (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false as const, issues: [{ path: "", code: "invalid_type" }] };
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const unknown = entries.find(([key]) => key !== "baseUrl");
    if (unknown) return { ok: false as const, issues: [{ path: unknown[0], code: "unrecognized_keys" }] };
    const baseUrl = (value as { baseUrl?: unknown }).baseUrl;
    if (baseUrl === undefined) return { ok: true as const, config: {} };
    if (typeof baseUrl !== "string" || !baseUrl.startsWith("https://")) {
      return { ok: false as const, issues: [{ path: "baseUrl", code: "invalid_string" }] };
    }
    return { ok: true as const, config: { baseUrl } };
  }
} as unknown as RegisteredConnector;

const catalogue = { types: () => ["demo"], find: (type: string) => (type === "demo" ? demo : null) };

class FakeRepository {
  readonly instances = new Map<string, ConnectorInstanceRecord>();
  readonly revoked: string[] = [];
  private next = 0;

  constructor() {
    this.instances.set(instanceId, {
      id: instanceId,
      connectorType: "demo",
      name: "Provider",
      status: "draft",
      config: { baseUrl: "https://provider.test" },
      configVersion: 1,
      healthStatus: "unknown",
      healthCheckedAt: null,
      lastErrorCode: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    });
  }

  createInstance(_context: TenantContext, input: CreateInstanceInput): Promise<ConnectorInstanceRecord> {
    this.next += 1;
    const created: ConnectorInstanceRecord = {
      id: `i-${this.next}`,
      connectorType: input.connectorType,
      name: input.name,
      status: "draft",
      config: input.config,
      configVersion: 1,
      healthStatus: "unknown",
      healthCheckedAt: null,
      lastErrorCode: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    };
    this.instances.set(created.id, created);
    return Promise.resolve(created);
  }

  listInstances(): Promise<ConnectorInstanceRecord[]> {
    return Promise.resolve([...this.instances.values()]);
  }

  getInstance(_context: TenantContext, id: string): Promise<ConnectorInstanceRecord | null> {
    return Promise.resolve(this.instances.get(id) ?? null);
  }

  updateInstanceConfig(
    _context: TenantContext,
    id: string,
    config: ConnectorConfig
  ): Promise<ConnectorInstanceRecord | null> {
    const instance = this.instances.get(id);
    if (!instance) return Promise.resolve(null);
    const updated = { ...instance, config, configVersion: instance.configVersion + 1 };
    this.instances.set(id, updated);
    return Promise.resolve(updated);
  }

  setInstanceStatus(
    _context: TenantContext,
    id: string,
    status: ConnectorInstanceRecord["status"]
  ): Promise<ConnectorInstanceRecord | null> {
    const instance = this.instances.get(id);
    if (!instance) return Promise.resolve(null);
    const updated = { ...instance, status };
    this.instances.set(id, updated);
    return Promise.resolve(updated);
  }

  revokeCredentials(_context: TenantContext, id: string): Promise<number> {
    this.revoked.push(id);
    return Promise.resolve(2);
  }

  listRuns(_context: TenantContext, id: string, page: number, pageSize: number): Promise<RunPage> {
    return Promise.resolve({ items: [], total: 0, page, pageSize });
  }
}

class FakeQueue implements ConnectorHealthCheckQueue {
  readonly requests: { tenantId: string; instanceId: string; idempotencyKey: string | null }[] = [];
  requestHealthCheck(input: { tenantId: string; instanceId: string; idempotencyKey: string | null }): Promise<string> {
    this.requests.push(input);
    return Promise.resolve(`health:${input.instanceId}`);
  }
}

/** The refusal itself, so a test can read its code and its issues rather than only its message. */
async function refusalOf(call: Promise<unknown>): Promise<ConnectorServiceError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConnectorServiceError) return error;
    throw error;
  }
  throw new Error("the call was expected to be refused and was not");
}

let repository: FakeRepository;
let queue: FakeQueue;
let service: ConnectorService;

beforeEach(() => {
  repository = new FakeRepository();
  queue = new FakeQueue();
  service = new ConnectorService(repository as unknown as ConnectorRepository, catalogue, queue);
});

describe("creating an integration", () => {
  it("stores the configuration the connector parsed, not the one that arrived", async () => {
    const created = await service.create(owner, {
      connectorType: "demo",
      name: "  Provider  ",
      config: { baseUrl: "https://provider.test" }
    });
    expect(created.name).toBe("Provider");
    expect(created.config).toEqual({ baseUrl: "https://provider.test" });
  });

  /** Acceptance criterion 2: an unknown field, a wrong type and an undeclared scheme. */
  it("refuses a configuration the connector does not recognise, saying where", async () => {
    const attempts: [unknown, string][] = [
      [{ nickname: "prod" }, "nickname"],
      [{ baseUrl: 42 }, "baseUrl"],
      [{ baseUrl: "http://provider.test" }, "baseUrl"]
    ];
    for (const [config, path] of attempts) {
      const error = await refusalOf(service.create(owner, { connectorType: "demo", name: "Provider", config }));
      expect(error.code).toBe("INVALID_CONFIG");
      expect(error.issues.map((issue) => issue.path)).toEqual([path]);
    }
  });

  it("carries no submitted value in the issues, because they travel to a screen and a log", async () => {
    const error = await refusalOf(
      service.create(owner, { connectorType: "demo", name: "Provider", config: { baseUrl: "http://sk_live_9f2c8ab4" } })
    );
    expect(JSON.stringify(error.issues)).not.toContain("sk_live_9f2c8ab4");
  });

  it("refuses a type this release does not ship", async () => {
    await expect(service.create(owner, { connectorType: "nope", name: "Nope", config: {} })).rejects.toThrow(
      "UNKNOWN_CONNECTOR_TYPE"
    );
  });

  it("refuses a name nobody could tell apart", async () => {
    await expect(service.create(owner, { connectorType: "demo", name: " ", config: {} })).rejects.toThrow(
      "INVALID_NAME"
    );
    await expect(
      service.create(owner, { connectorType: "demo", name: "a".repeat(121), config: {} })
    ).rejects.toThrow("INVALID_NAME");
  });
});

describe("who may change an integration", () => {
  /** Acceptance criterion 7, against the roles the product actually defines. */
  it("refuses an administrator everything that changes something", async () => {
    await expect(
      service.create(administrator, { connectorType: "demo", name: "Provider", config: {} })
    ).rejects.toThrow("FORBIDDEN");
    await expect(service.updateConfig(administrator, instanceId, {})).rejects.toThrow("FORBIDDEN");
    await expect(service.enable(administrator, instanceId)).rejects.toThrow("FORBIDDEN");
    await expect(service.disable(administrator, instanceId)).rejects.toThrow("FORBIDDEN");
    await expect(service.requestHealthCheck(administrator, instanceId)).rejects.toThrow("FORBIDDEN");
  });

  it("lets an administrator read state, which is the half of the job they do have", async () => {
    await expect(service.list(administrator)).resolves.toHaveLength(1);
    await expect(service.get(administrator, instanceId)).resolves.toMatchObject({ id: instanceId });
    await expect(service.runs(administrator, instanceId, 1, 20)).resolves.toMatchObject({ total: 0 });
    expect(service.catalogueEntries(administrator).map((entry) => entry.type)).toEqual(["demo"]);
  });

  it("lets owner and technical manage, which is the matrix the specification fixed", async () => {
    await expect(service.enable(owner, instanceId)).resolves.toMatchObject({ status: "enabled" });
    await expect(service.enable(technical, instanceId)).resolves.toMatchObject({ status: "enabled" });
  });

  it("refuses somebody with no integrations permission at all, even to read", async () => {
    const stranger = asRole("administrator", { permissions: [] });
    await expect(service.list(stranger)).rejects.toThrow("FORBIDDEN");
    expect(() => service.catalogueEntries(stranger)).toThrow("FORBIDDEN");
  });
});

describe("changing an integration", () => {
  it("revalidates on update and raises the version", async () => {
    const updated = await service.updateConfig(owner, instanceId, { baseUrl: "https://other.test" });
    expect(updated.configVersion).toBe(2);
    await expect(service.updateConfig(owner, instanceId, { baseUrl: "ftp://other.test" })).rejects.toThrow(
      "INVALID_CONFIG"
    );
  });

  /**
   * A schema travels with a release. An instance stored under the previous one has to be refused
   * here, where somebody can act on it, rather than fail every five minutes in the worker.
   */
  it("refuses to enable an instance whose stored configuration no longer parses", async () => {
    repository.instances.set(instanceId, {
      ...repository.instances.get(instanceId)!,
      config: { removedField: "yes" }
    });
    await expect(service.enable(owner, instanceId)).rejects.toThrow("INVALID_CONFIG");
  });

  it("revokes the credentials when it disables, and only after the work has stopped", async () => {
    const result = await service.disable(owner, instanceId);
    expect(result.instance.status).toBe("disabled");
    expect(result.revokedCredentials).toBe(2);
    expect(repository.revoked).toEqual([instanceId]);
  });
});

describe("asking for a health check", () => {
  it("queues one for an enabled instance and says what it started", async () => {
    await service.enable(owner, instanceId);
    const requested = await service.requestHealthCheck(owner, instanceId, "key-1");
    expect(requested.requestId).toBe(`health:${instanceId}`);
    expect(queue.requests).toEqual([{ tenantId, instanceId, idempotencyKey: "key-1" }]);
  });

  it("refuses one for an instance the runtime would skip anyway", async () => {
    await expect(service.requestHealthCheck(owner, instanceId)).rejects.toThrow("INSTANCE_NOT_ENABLED");
    await service.disable(owner, instanceId);
    await expect(service.requestHealthCheck(owner, instanceId)).rejects.toThrow("INSTANCE_NOT_ENABLED");
    expect(queue.requests).toEqual([]);
  });
});

describe("an identifier from another tenant", () => {
  /**
   * Acceptance criterion 6. The read is tenant-scoped, so a manipulated identifier is not found
   * rather than forbidden: telling the difference is how somebody learns what exists elsewhere.
   */
  it("is not found, whatever is asked of it", async () => {
    await expect(service.get(owner, missingInstanceId)).rejects.toThrow("INSTANCE_NOT_FOUND");
    await expect(service.updateConfig(owner, missingInstanceId, {})).rejects.toThrow("INSTANCE_NOT_FOUND");
    await expect(service.enable(owner, missingInstanceId)).rejects.toThrow("INSTANCE_NOT_FOUND");
    await expect(service.disable(owner, missingInstanceId)).rejects.toThrow("INSTANCE_NOT_FOUND");
    await expect(service.runs(owner, missingInstanceId, 1, 20)).rejects.toThrow("INSTANCE_NOT_FOUND");
    await expect(service.requestHealthCheck(owner, missingInstanceId)).rejects.toThrow("INSTANCE_NOT_FOUND");
    expect(repository.revoked).toEqual([]);
  });
});

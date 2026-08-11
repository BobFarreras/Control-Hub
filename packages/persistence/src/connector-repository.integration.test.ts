import { randomUUID } from "node:crypto";
import { ConnectorStorageError } from "@control-hub/application";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresConnectorRepository } from "./connector-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminUrl ? describe : describe.skip;

const envelope = (byte: number) => ({
  nonce: Buffer.alloc(12, byte),
  ciphertext: Buffer.alloc(48, byte)
});

suite("PostgresConnectorRepository", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let repository: PostgresConnectorRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();

  const context = (tenantId: string, membershipId: string): TenantContext => ({
    tenantId,
    membershipId,
    userId,
    roles: ["owner"],
    permissions: ["integrations:read", "integrations:manage", "credentials:rotate"],
    mfaEnabled: true
  });

  const asA = () => context(tenantA, membershipA);
  const asB = () => context(tenantB, membershipB);

  const newInstance = async (tenantId: string, membershipId: string) =>
    repository.createInstance(context(tenantId, membershipId), {
      connectorType: "generic-webhook",
      name: `instance ${randomUUID()}`,
      config: { eventIdPath: "id" }
    });

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminUrl!);
    repository = new PostgresConnectorRepository(database);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Connector Test', ${`${userId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`conn-a-${tenantA}`}, 'Conn A'), (${tenantB}, ${`conn-b-${tenantB}`}, 'Conn B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userId}), (${membershipB}, ${tenantB}, ${userId})`;
  });

  afterAll(async () => {
    // Everything under a tenant cascades from the tenant row, connector tables included.
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id = ${userId}`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  describe("instances", () => {
    it("stores a configuration and starts at draft, unknown health", async () => {
      const instance = await newInstance(tenantA, membershipA);
      expect(instance.status).toBe("draft");
      expect(instance.healthStatus).toBe("unknown");
      expect(instance.configVersion).toBe(1);
      expect(instance.config).toEqual({ eventIdPath: "id" });
    });

    it("refuses two instances sharing a name inside one tenant", async () => {
      const first = await newInstance(tenantA, membershipA);
      await expect(
        repository.createInstance(asA(), {
          connectorType: "generic-webhook",
          name: first.name,
          config: {}
        })
      ).rejects.toThrow("DUPLICATE_INSTANCE_NAME");
    });

    it("lets two tenants use the same name, which is not a collision", async () => {
      const first = await newInstance(tenantA, membershipA);
      const second = await repository.createInstance(asB(), {
        connectorType: "generic-webhook",
        name: first.name,
        config: {}
      });
      expect(second.name).toBe(first.name);
    });

    it("raises the configuration version with the configuration it describes", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const updated = await repository.updateInstanceConfig(asA(), instance.id, { eventIdPath: "data.id" });
      expect(updated?.configVersion).toBe(2);
      expect(updated?.config).toEqual({ eventIdPath: "data.id" });
    });

    it("drops a stale health reading when an instance is disabled", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.recordHealth(asA(), instance.id, {
        status: "healthy",
        checkedAt: new Date(),
        errorCode: null
      });
      const disabled = await repository.setInstanceStatus(asA(), instance.id, "disabled");
      expect(disabled?.healthStatus).toBe("disabled");
      expect(disabled?.healthCheckedAt).toBeNull();
    });

    it("refuses a health claim with no reading behind it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await expect(
        admin`update connector_instances set health_status = 'healthy', health_checked_at = null
          where id = ${instance.id}`
      ).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("does not show one tenant's instance to another, nor list it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      expect(await repository.getInstance(asB(), instance.id)).toBeNull();
      expect((await repository.listInstances(asB())).map((row) => row.id)).not.toContain(instance.id);
    });

    it("does not let a manipulated identifier reach across, on read or on write", async () => {
      const instance = await newInstance(tenantA, membershipA);
      expect(await repository.updateInstanceConfig(asB(), instance.id, { stolen: true })).toBeNull();
      expect(await repository.setInstanceStatus(asB(), instance.id, "enabled")).toBeNull();

      const untouched = await repository.getInstance(asA(), instance.id);
      expect(untouched?.config).toEqual({ eventIdPath: "id" });
      expect(untouched?.status).toBe("draft");
    });

    it("refuses to hang a credential off another tenant's instance", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await expect(
        repository.putCredential(asB(), {
          instanceId: instance.id,
          kind: "ingress_signing",
          slot: "primary",
          keyId: "k1",
          ...envelope(1)
        })
      ).rejects.toThrow("INSTANCE_NOT_FOUND");
    });

    /**
     * The tests above go through the repository, which always writes `where tenant_id`. These two
     * take that clause away: if the isolation only lived in the query, an adapter that forgot it
     * once would be enough, and there would be nothing here to notice.
     */
    it("shows nothing across tenants even to a query with no tenant clause at all", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const seen = await database.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantB}, true)`;
        return tx<{ id: string }[]>`select id from connector_instances where id = ${instance.id}`;
      });
      expect(seen).toEqual([]);
    });

    it("shows nothing at all when no tenant has been set", async () => {
      await newInstance(tenantA, membershipA);
      const seen = await database<{ id: string }[]>`select id from connector_instances limit 1`;
      expect(seen).toEqual([]);
    });

    it("keeps each tenant's run history to itself", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.startRun(asA(), {
        instanceId: instance.id,
        operation: "health_check",
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        configVersion: 1
      });
      expect((await repository.listRuns(asB(), instance.id, 1, 20)).total).toBe(0);
      expect((await repository.listRuns(asA(), instance.id, 1, 20)).total).toBe(1);
    });
  });

  describe("credentials", () => {
    it("returns metadata and never the envelope", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const stored = await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "primary",
        keyId: "ring-1",
        ...envelope(7)
      });
      expect(stored.keyId).toBe("ring-1");
      expect(stored.rotatedAt).toBeInstanceOf(Date);

      const listed = await repository.listCredentials(asA(), instance.id);
      const serialised = JSON.stringify(listed);
      expect(serialised).not.toContain("ciphertext");
      expect(serialised).not.toContain("nonce");
    });

    it("holds two live credentials of a kind and refuses a third", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const put = (slot: "primary" | "secondary", byte: number) =>
        repository.putCredential(asA(), {
          instanceId: instance.id,
          kind: "ingress_signing",
          slot,
          keyId: `ring-${byte}`,
          ...envelope(byte)
        });

      await put("primary", 1);
      await put("secondary", 2);
      await expect(put("secondary", 3)).rejects.toThrow("CREDENTIAL_SLOT_TAKEN");
      await expect(put("secondary", 3)).rejects.toBeInstanceOf(ConnectorStorageError);
    });

    it("hands the worker the newest first, and forgets a revoked one", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "primary",
        keyId: "old",
        ...envelope(1)
      });
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "secondary",
        keyId: "new",
        ...envelope(2)
      });

      const live = await repository.readSealedCredentials(asA(), instance.id, "ingress_signing");
      expect(live.map((credential) => credential.keyId)).toEqual(["new", "old"]);
      expect(Buffer.from(live[0]!.nonce)).toHaveLength(12);

      expect(await repository.revokeCredentials(asA(), instance.id)).toBe(2);
      expect(await repository.readSealedCredentials(asA(), instance.id, "ingress_signing")).toEqual([]);
    });

    it("frees the slot once a credential is revoked, which is what ends a rotation", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const put = (byte: number) =>
        repository.putCredential(asA(), {
          instanceId: instance.id,
          kind: "ingress_signing",
          slot: "primary",
          keyId: `ring-${byte}`,
          ...envelope(byte)
        });
      await put(1);
      await repository.revokeCredentials(asA(), instance.id, "ingress_signing");
      await expect(put(2)).resolves.toMatchObject({ keyId: "ring-2" });
    });
  });

  describe("runs", () => {
    it("gives a redelivered attempt the row it already has, not a second one", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const input = {
        instanceId: instance.id,
        operation: "health_check",
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        configVersion: 1
      };

      const first = await repository.startRun(asA(), input);
      const second = await repository.startRun(asA(), input);
      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(second.run.id).toBe(first.run.id);
      expect((await repository.listRuns(asA(), instance.id, 1, 20)).total).toBe(1);
    });

    it("counts a retry as its own attempt, because it is one", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const jobId = `job-${randomUUID()}`;
      const base = { instanceId: instance.id, operation: "pull", jobId, configVersion: 1 };
      await repository.startRun(asA(), { ...base, attempt: 1 });
      await repository.startRun(asA(), { ...base, attempt: 2 });
      expect((await repository.listRuns(asA(), instance.id, 1, 20)).total).toBe(2);
    });

    it("closes a run once, and answers nothing the second time", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const { run } = await repository.startRun(asA(), {
        instanceId: instance.id,
        operation: "pull",
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        configVersion: 1
      });

      const finished = await repository.finishRun(asA(), run.id, { status: "succeeded", itemsProcessed: 3 });
      expect(finished?.status).toBe("succeeded");
      expect(finished?.itemsProcessed).toBe(3);
      expect(finished?.errorCode).toBeNull();
      expect(await repository.finishRun(asA(), run.id, { status: "failed", errorCode: "timeout" })).toBeNull();
    });

    it("keeps a dead letter, with the code that produced it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const { run } = await repository.startRun(asA(), {
        instanceId: instance.id,
        operation: "pull",
        jobId: `job-${randomUUID()}`,
        attempt: 5,
        configVersion: 1
      });
      const dead = await repository.finishRun(asA(), run.id, { status: "dead_letter", errorCode: "timeout" });
      expect(dead).toMatchObject({ status: "dead_letter", errorCode: "timeout" });
    });

    it("refuses a failure with no reason recorded", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const { run } = await repository.startRun(asA(), {
        instanceId: instance.id,
        operation: "pull",
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        configVersion: 1
      });
      await expect(
        admin`update connector_sync_runs set status = 'failed', finished_at = now(), error_code = null
          where id = ${run.id}`
      ).rejects.toThrow();
    });
  });

  describe("ingress endpoints", () => {
    it("mints an unguessable identifier and hands it over once", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const created = await repository.createEndpoint(asA(), instance.id);
      expect(created.publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const listed = await repository.listEndpoints(asA(), instance.id);
      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain(created.publicId);
    });

    it("resolves a public identifier with no tenant in hand, and tells nothing more", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const created = await repository.createEndpoint(asA(), instance.id);

      const resolved = await repository.resolveEndpoint(created.publicId);
      expect(resolved).toEqual({
        id: created.id,
        tenantId: tenantA,
        instanceId: instance.id,
        connectorType: "generic-webhook",
        status: "draft"
      });
      // The shape is the guarantee: widening it must take a migration somebody reviews.
      expect(Object.keys(resolved!).sort()).toEqual(["connectorType", "id", "instanceId", "status", "tenantId"]);
    });

    it("answers nothing for an unknown identifier and for a revoked one alike", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const created = await repository.createEndpoint(asA(), instance.id);

      expect(await repository.revokeEndpoint(asA(), created.id)).toBe(true);
      expect(await repository.resolveEndpoint(created.publicId)).toBeNull();
      expect(await repository.resolveEndpoint("A".repeat(43))).toBeNull();
    });

    it("does not let another tenant revoke an endpoint it cannot see", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const created = await repository.createEndpoint(asA(), instance.id);
      expect(await repository.revokeEndpoint(asB(), created.id)).toBe(false);
      expect(await repository.resolveEndpoint(created.publicId)).not.toBeNull();
    });
  });

  describe("inbox", () => {
    const event = (endpointId: string, providerEventId: string) => ({
      endpointId,
      providerEventId,
      payloadHash: "a".repeat(64),
      payload: '{"id":"evt_1"}'
    });

    it("recognises a redelivery by constraint rather than by looking first", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const endpoint = await repository.createEndpoint(asA(), instance.id);

      const first = await repository.recordInboxEvent(asA(), event(endpoint.id, "evt_1"));
      const second = await repository.recordInboxEvent(asA(), event(endpoint.id, "evt_1"));
      expect(first.duplicate).toBe(false);
      expect(second).toEqual({ id: first.id, duplicate: true });
    });

    it("does not treat two tenants' identical event ids as the same event", async () => {
      const instanceA = await newInstance(tenantA, membershipA);
      const instanceB = await newInstance(tenantB, membershipB);
      const endpointA = await repository.createEndpoint(asA(), instanceA.id);
      const endpointB = await repository.createEndpoint(asB(), instanceB.id);

      const inA = await repository.recordInboxEvent(asA(), event(endpointA.id, "evt_shared"));
      const inB = await repository.recordInboxEvent(asB(), event(endpointB.id, "evt_shared"));
      expect(inA.duplicate).toBe(false);
      expect(inB.duplicate).toBe(false);
    });

    it("counts an attempt without calling it a verdict", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const endpoint = await repository.createEndpoint(asA(), instance.id);
      const recorded = await repository.recordInboxEvent(asA(), event(endpoint.id, "evt_attempts"));

      await repository.recordInboxAttempt(asA(), recorded.id);
      const pending = (await repository.listPendingInbox(asA(), 100)).find((row) => row.id === recorded.id);
      expect(pending?.attempts).toBe(1);
      expect(pending?.status).toBe("pending");
    });

    it("takes a finished event out of what is pending, once", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const endpoint = await repository.createEndpoint(asA(), instance.id);
      const recorded = await repository.recordInboxEvent(asA(), event(endpoint.id, "evt_done"));
      const processedAt = new Date();

      await repository.finishInboxEvent(asA(), recorded.id, { status: "processed", processedAt });
      expect((await repository.listPendingInbox(asA(), 10)).map((row) => row.id)).not.toContain(recorded.id);

      // A redelivered job must not overwrite the verdict already written.
      await repository.finishInboxEvent(asA(), recorded.id, { status: "failed", processedAt: new Date() });
      const [row] = await admin<{ status: string }[]>`
        select status from connector_inbox where id = ${recorded.id}`;
      expect(row?.status).toBe("processed");
    });

    it("does not show one tenant's inbox to another", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const endpoint = await repository.createEndpoint(asA(), instance.id);
      const recorded = await repository.recordInboxEvent(asA(), event(endpoint.id, "evt_private"));
      const seenByB = await repository.listPendingInbox(asB(), 100);
      expect(seenByB.map((row) => row.id)).not.toContain(recorded.id);
      expect(seenByB.map((row) => row.endpointId)).not.toContain(endpoint.id);
    });
  });
});

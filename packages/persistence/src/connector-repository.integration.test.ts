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

  /**
   * Increment A9b: removing an integration takes everything that hangs off it.
   *
   * This is the test the whole design of the deletion rests on. The repository issues one delete
   * against `connector_instances` and trusts the schema for the rest, which is only defensible if
   * something checks that the schema really does the rest — and checks it against PostgreSQL,
   * because two of the answers involved are not in the SQL text at all: whether a cascade needs
   * its own delete privilege on the referencing tables (it does not, referential actions run as
   * the owner) and whether forced row-level security blocks one (it does not, they run outside
   * it). Neither is something to take on trust from a manual page.
   *
   * The rows are counted through `admin`, not through the repository: after the delete the
   * repository would refuse to name the instance at all, so a read through it could report an
   * empty list for a row that is still sitting in the table.
   */
  describe("removing an instance", () => {
    /** Every table that hangs off an instance, directly or through one that does. */
    const dependants = [
      "connector_credentials",
      "connector_sync_runs",
      "connector_webhook_endpoints",
      "connector_inbox",
      "connector_records",
      "connector_operation_state",
      "infra_automation_links",
      "infra_alert_rules",
      "infra_alert_events"
    ] as const;

    /**
     * An instance with a row in every one of those tables.
     *
     * Written through the repository where there is a method and through `admin` where the
     * platform has none — the infrastructure module owns its own writes, and borrowing them here
     * would tie this test to a module it is not testing.
     */
    async function populated() {
      const instance = await newInstance(tenantA, membershipA);
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "api_key",
        slot: "primary",
        keyId: "ring-1",
        ...envelope(7)
      });
      await repository.startRun(asA(), {
        instanceId: instance.id,
        operation: "health_check",
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        configVersion: 1
      });
      const endpoint = await repository.createEndpoint(asA(), instance.id);
      await repository.recordInboxEvent(asA(), {
        endpointId: endpoint.id,
        providerEventId: `evt-${randomUUID()}`,
        payloadHash: "b".repeat(64),
        payload: '{"id":"evt_1"}'
      });
      await repository.upsertRecords(asA(), {
        instanceId: instance.id,
        operation: "workflows",
        shape: "state",
        records: [{ externalId: "wf_1", data: { active: true } }],
        seenAt: new Date()
      });
      await repository.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "workflows",
        cursor: "1",
        ranAt: new Date(),
        succeeded: true
      });

      const ruleId = randomUUID();
      await admin`insert into infra_automation_links (id, tenant_id, instance_id, external_id)
        values (${randomUUID()}, ${tenantA}, ${instance.id}, 'wf_1')`;
      await admin`insert into infra_alert_rules
        (id, tenant_id, name, kind, instance_id, target_type, severity, freshness_seconds)
        values (${ruleId}, ${tenantA}, ${`rule ${ruleId}`}, 'workflow_failed', ${instance.id}, 'instance', 'high', 300)`;
      await admin`insert into infra_alert_events (id, tenant_id, rule_id, dedup_key, status, severity)
        values (${randomUUID()}, ${tenantA}, ${ruleId}, 'wf_1', 'firing', 'high')`;

      return instance;
    }

    /** How many rows of a table belong to this instance, whether directly or through a parent. */
    async function rowsFor(table: string, instanceId: string): Promise<number> {
      const scoped =
        table === "connector_inbox"
          ? admin<{ count: number }[]>`select count(*)::int as count from connector_inbox i
              join connector_webhook_endpoints e on e.id = i.endpoint_id
              where e.instance_id = ${instanceId}`
          : table === "infra_alert_events"
            ? admin<{ count: number }[]>`select count(*)::int as count from infra_alert_events v
                join infra_alert_rules r on r.id = v.rule_id
                where r.instance_id = ${instanceId}`
            : admin<{ count: number }[]>`select count(*)::int as count
                from ${admin.unsafe(table)} where instance_id = ${instanceId}`;
      return (await scoped)[0]!.count;
    }

    it("leaves no row behind in any table that hangs off it", async () => {
      const instance = await populated();
      for (const table of dependants) expect([table, await rowsFor(table, instance.id)]).toEqual([table, 1]);

      await repository.deleteInstance(asA(), instance.id);

      expect(await repository.getInstance(asA(), instance.id)).toBeNull();
      for (const table of dependants) expect([table, await rowsFor(table, instance.id)]).toEqual([table, 0]);
    });

    it("counts what went before it goes, so an audit line can say more than deleted", async () => {
      const instance = await populated();
      const summary = await repository.deleteInstance(asA(), instance.id);
      expect(summary?.instance).toMatchObject({ id: instance.id, name: instance.name });
      expect(summary?.removed).toEqual({ credentials: 1, runs: 1, endpoints: 1 });
    });

    it("removes nothing for a tenant the instance does not belong to", async () => {
      const instance = await populated();
      expect(await repository.deleteInstance(asB(), instance.id)).toBeNull();
      expect(await repository.getInstance(asA(), instance.id)).not.toBeNull();
      for (const table of dependants) expect([table, await rowsFor(table, instance.id)]).toEqual([table, 1]);
    });

    it("is null for an instance that is not there, rather than a summary of nothing", async () => {
      expect(await repository.deleteInstance(asA(), randomUUID())).toBeNull();
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

    it("promotes the secondary and revokes the old primary in one step", async () => {
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
      const secondary = await put("secondary", 2);

      const promoted = await repository.promoteCredential(asA(), instance.id, "ingress_signing");
      expect(promoted).toMatchObject({ id: secondary.id, slot: "primary", keyId: "ring-2" });
      expect(promoted!.rotatedAt!.getTime()).toBeGreaterThanOrEqual(secondary.rotatedAt!.getTime());

      const live = await repository.readSealedCredentials(asA(), instance.id, "ingress_signing");
      expect(live.map((credential) => credential.keyId)).toEqual(["ring-2"]);
      expect((await repository.listCredentials(asA(), instance.id)).filter((row) => row.revokedAt)).toHaveLength(1);
    });

    it("leaves the primary alone when there is no secondary to promote", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "primary",
        keyId: "ring-1",
        ...envelope(1)
      });

      expect(await repository.promoteCredential(asA(), instance.id, "ingress_signing")).toBeNull();
      const live = await repository.readSealedCredentials(asA(), instance.id, "ingress_signing");
      expect(live.map((credential) => credential.keyId)).toEqual(["ring-1"]);
    });

    it("promotes only the kind it was asked for", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const put = (kind: string, slot: "primary" | "secondary", byte: number) =>
        repository.putCredential(asA(), {
          instanceId: instance.id,
          kind,
          slot,
          keyId: `${kind}-${byte}`,
          ...envelope(byte)
        });
      await put("ingress_signing", "primary", 1);
      await put("ingress_signing", "secondary", 2);
      await put("api_key", "primary", 3);
      await put("api_key", "secondary", 4);

      await repository.promoteCredential(asA(), instance.id, "api_key");
      expect(
        (await repository.readSealedCredentials(asA(), instance.id, "ingress_signing")).map(
          (credential) => credential.keyId
        )
      ).toEqual(["ingress_signing-2", "ingress_signing-1"]);
    });

    it("promotes nothing that belongs to another tenant", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "primary",
        keyId: "ring-1",
        ...envelope(1)
      });
      await repository.putCredential(asA(), {
        instanceId: instance.id,
        kind: "ingress_signing",
        slot: "secondary",
        keyId: "ring-2",
        ...envelope(2)
      });

      expect(await repository.promoteCredential(asB(), instance.id, "ingress_signing")).toBeNull();
      const live = await repository.readSealedCredentials(asA(), instance.id, "ingress_signing");
      expect(live.map((credential) => credential.keyId)).toEqual(["ring-2", "ring-1"]);
    });
  });

  describe("runs", () => {
    const started = (result: Awaited<ReturnType<typeof repository.startRun>>) => {
      if (result.outcome === "already_running") throw new Error("expected a run to have started");
      return result.run;
    };

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
      expect(first.outcome).toBe("started");
      expect(second.outcome).toBe("already_attempted");
      expect(started(second).id).toBe(started(first).id);
      expect((await repository.listRuns(asA(), instance.id, 1, 20)).total).toBe(1);
    });

    it("counts a retry as its own attempt, because it is one", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const jobId = `job-${randomUUID()}`;
      const base = { instanceId: instance.id, operation: "pull", jobId, configVersion: 1 };

      const first = await repository.startRun(asA(), { ...base, attempt: 1 });
      // A retry happens after the previous attempt ended, which is what makes it a retry.
      await repository.finishRun(asA(), started(first).id, { status: "failed", errorCode: "timeout" });
      expect((await repository.startRun(asA(), { ...base, attempt: 2 })).outcome).toBe("started");

      expect((await repository.listRuns(asA(), instance.id, 1, 20)).total).toBe(2);
    });

    /**
     * The ceiling that keeps a slow instance to one worker slot. Enforced by a partial unique
     * index rather than by looking first: two workers would both read no running row, both
     * insert, and both be right about what they saw.
     */
    it("refuses a second pass of one operation while the first is still running", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const base = { instanceId: instance.id, operation: "pull", configVersion: 1, attempt: 1 };

      const first = await repository.startRun(asA(), { ...base, jobId: `job-${randomUUID()}` });
      const second = await repository.startRun(asA(), { ...base, jobId: `job-${randomUUID()}` });

      expect(second).toEqual({ outcome: "already_running" });
      // The pass that stood down changed nothing: the run in flight is still in flight.
      const runs = await repository.listRuns(asA(), instance.id, 1, 20);
      expect(runs.total).toBe(1);
      expect(runs.items[0]).toMatchObject({ id: started(first).id, status: "running" });
    });

    it("lets two different operations of one instance run at the same time", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const base = { instanceId: instance.id, configVersion: 1, attempt: 1 };

      const pull = await repository.startRun(asA(), { ...base, operation: "pull", jobId: `job-${randomUUID()}` });
      const health = await repository.startRun(asA(), { ...base, operation: "health", jobId: `job-${randomUUID()}` });

      expect(pull.outcome).toBe("started");
      expect(health.outcome).toBe("started");
    });

    /**
     * Without this a worker killed mid-run would hold its operation shut for ever, and the only
     * cure would be somebody editing the database. The lease is what makes the ceiling above
     * self-healing rather than a new way to lose an integration silently.
     */
    it("takes over from a run whose lease has expired, and writes the old one off", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const base = { instanceId: instance.id, operation: "pull", configVersion: 1, attempt: 1 };

      const abandoned = started(await repository.startRun(asA(), { ...base, jobId: `job-${randomUUID()}` }));
      await admin`update connector_sync_runs set started_at = now() - interval '2 hours'
        where id = ${abandoned.id}`;

      const taken = await repository.startRun(asA(), { ...base, jobId: `job-${randomUUID()}` });
      expect(taken.outcome).toBe("started");

      const [old] = await admin<{ status: string; error_code: string | null }[]>`
        select status, error_code from connector_sync_runs where id = ${abandoned.id}`;
      // Written off, not deleted: a run that was cut short is the one somebody needs to see.
      expect(old).toMatchObject({ status: "dead_letter", error_code: "RUN_ABANDONED" });
    });

    it("closes a run once, and answers nothing the second time", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const run = started(
        await repository.startRun(asA(), {
          instanceId: instance.id,
          operation: "pull",
          jobId: `job-${randomUUID()}`,
          attempt: 1,
          configVersion: 1
        })
      );

      const finished = await repository.finishRun(asA(), run.id, { status: "succeeded", itemsProcessed: 3 });
      expect(finished?.status).toBe("succeeded");
      expect(finished?.itemsProcessed).toBe(3);
      expect(finished?.errorCode).toBeNull();
      expect(await repository.finishRun(asA(), run.id, { status: "failed", errorCode: "timeout" })).toBeNull();
    });

    it("keeps a dead letter, with the code that produced it", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const run = started(
        await repository.startRun(asA(), {
          instanceId: instance.id,
          operation: "pull",
          jobId: `job-${randomUUID()}`,
          attempt: 5,
          configVersion: 1
        })
      );
      const dead = await repository.finishRun(asA(), run.id, { status: "dead_letter", errorCode: "timeout" });
      expect(dead).toMatchObject({ status: "dead_letter", errorCode: "timeout" });
    });

    it("refuses a failure with no reason recorded", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const run = started(
        await repository.startRun(asA(), {
          instanceId: instance.id,
          operation: "pull",
          jobId: `job-${randomUUID()}`,
          attempt: 1,
          configVersion: 1
        })
      );
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
      expect(await repository.getPendingInbox(asB(), recorded.id)).toBeNull();
      expect(await repository.getPendingInbox(asA(), recorded.id)).toMatchObject({
        id: recorded.id,
        tenantId: tenantA,
        instanceId: instance.id,
        connectorType: "generic-webhook",
        instanceStatus: "draft",
        config: {}
      });
    });
  });

  describe("records", () => {
    const pull = (instanceId: string, operation: string, shape: "state" | "event") => ({
      instanceId,
      operation,
      shape
    });

    it("leaves one row per external id, remembering when it was first seen", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const first = new Date("2026-08-01T10:00:00.000Z");
      const second = new Date("2026-08-01T11:00:00.000Z");

      const initial = await repository.upsertRecords(asA(), {
        ...pull(instance.id, "workflows", "state"),
        records: [
          { externalId: "wf_1", data: { active: true } },
          { externalId: "wf_2", data: { active: false } }
        ],
        seenAt: first
      });
      const again = await repository.upsertRecords(asA(), {
        ...pull(instance.id, "workflows", "state"),
        records: [{ externalId: "wf_1", data: { active: false } }],
        seenAt: second
      });

      expect(initial).toEqual({ inserted: 2, updated: 0 });
      expect(again).toEqual({ inserted: 0, updated: 1 });

      const rows = await admin<{ external_id: string; data: unknown; first_seen_at: Date; last_seen_at: Date }[]>`
        select external_id, data, first_seen_at, last_seen_at from connector_records
        where instance_id = ${instance.id} order by external_id`;

      expect(rows.map((row) => row.external_id)).toEqual(["wf_1", "wf_2"]);
      expect(rows[0]?.data).toEqual({ active: false });
      // The second pass moved the sighting forward and left the discovery where it was.
      expect(rows[0]?.first_seen_at).toEqual(first);
      expect(rows[0]?.last_seen_at).toEqual(second);
    });

    it("separates the same external id under two operations", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const seenAt = new Date("2026-08-02T09:00:00.000Z");

      for (const operation of ["workflows", "executions"]) {
        await repository.upsertRecords(asA(), {
          ...pull(instance.id, operation, "state"),
          records: [{ externalId: "shared_id", data: { operation } }],
          seenAt
        });
      }

      const rows = await admin<{ operation: string }[]>`
        select operation from connector_records
        where instance_id = ${instance.id} and external_id = 'shared_id' order by operation`;
      expect(rows.map((row) => row.operation)).toEqual(["executions", "workflows"]);
    });

    it("refuses to hang a record off another tenant's instance", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await expect(
        repository.upsertRecords(asB(), {
          ...pull(instance.id, "workflows", "state"),
          records: [{ externalId: "wf_stolen", data: {} }],
          seenAt: new Date()
        })
      ).rejects.toThrow("INSTANCE_NOT_FOUND");
    });

    /** As with the tables above: the isolation has to hold with the tenant clause taken away. */
    it("shows nothing across tenants even to a query with no tenant clause at all", async () => {
      const instance = await newInstance(tenantA, membershipA);
      await repository.upsertRecords(asA(), {
        ...pull(instance.id, "workflows", "state"),
        records: [{ externalId: "wf_private", data: {} }],
        seenAt: new Date()
      });

      const seen = await database.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantB}, true)`;
        return tx<{ external_id: string }[]>`
          select external_id from connector_records where instance_id = ${instance.id}`;
      });
      expect(seen).toEqual([]);
    });

    it("keeps a cursor per operation, and not across tenants", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const ranAt = new Date("2026-08-03T08:00:00.000Z");

      await repository.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "workflows",
        cursor: "page-2",
        ranAt,
        succeeded: true
      });
      await repository.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "executions",
        cursor: "2026-08-03T07:59:00Z",
        ranAt,
        succeeded: true
      });

      expect(await repository.readOperationState(asA(), instance.id, "workflows")).toMatchObject({
        cursor: "page-2",
        lastRunAt: ranAt,
        lastSuccessAt: ranAt
      });
      expect((await repository.readOperationState(asA(), instance.id, "executions"))?.cursor).toBe(
        "2026-08-03T07:59:00Z"
      );
      expect(await repository.readOperationState(asB(), instance.id, "workflows")).toBeNull();
    });

    it("does not move the last success when a pass fails", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const worked = new Date("2026-08-04T08:00:00.000Z");
      const failed = new Date("2026-08-04T08:05:00.000Z");

      await repository.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "workflows",
        cursor: "page-1",
        ranAt: worked,
        succeeded: true
      });
      await repository.saveOperationState(asA(), {
        instanceId: instance.id,
        operation: "workflows",
        cursor: "page-1",
        ranAt: failed,
        succeeded: false
      });

      // The age a screen shows is the age of the answer, not the age of the attempt.
      expect(await repository.readOperationState(asA(), instance.id, "workflows")).toMatchObject({
        lastRunAt: failed,
        lastSuccessAt: worked
      });
    });

    it("expires each shape on its own clock and leaves fresh rows alone", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const now = Date.now();
      const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);

      await repository.upsertRecords(asA(), {
        ...pull(instance.id, "workflows", "state"),
        records: [{ externalId: "wf_gone", data: {} }],
        seenAt: daysAgo(40)
      });
      await repository.upsertRecords(asA(), {
        ...pull(instance.id, "executions", "event"),
        records: [
          { externalId: "exec_old", data: {} },
          { externalId: "exec_kept", data: {} }
        ],
        seenAt: daysAgo(40)
      });
      // The survivor is the same shape as `exec_old`, only younger than the window.
      await repository.upsertRecords(asA(), {
        ...pull(instance.id, "executions", "event"),
        records: [{ externalId: "exec_kept", data: {} }],
        seenAt: daysAgo(10)
      });

      const result = await repository.purgeRecords({
        stateBefore: daysAgo(30),
        eventBefore: daysAgo(90),
        maxPerOperation: 100_000,
        batchLimit: 5_000
      });

      // A 40-day-old state row is past its window; a 40-day-old event row is not past its own.
      expect(result.purged).toBeGreaterThanOrEqual(1);
      const survivors = await admin<{ external_id: string }[]>`
        select external_id from connector_records where instance_id = ${instance.id} order by external_id`;
      expect(survivors.map((row) => row.external_id)).toEqual(["exec_kept", "exec_old"]);
    });

    it("trims the oldest first when an operation goes past its ceiling", async () => {
      const instance = await newInstance(tenantA, membershipA);
      const base = Date.parse("2026-08-05T00:00:00.000Z");

      for (const [index, externalId] of ["exec_1", "exec_2", "exec_3", "exec_4"].entries()) {
        await repository.upsertRecords(asA(), {
          ...pull(instance.id, "executions", "event"),
          records: [{ externalId, data: {} }],
          seenAt: new Date(base + index * 60_000)
        });
      }

      // Epoch on both windows, so nothing expires and only the ceiling can delete anything.
      const result = await repository.purgeRecords({
        stateBefore: new Date(0),
        eventBefore: new Date(0),
        maxPerOperation: 2,
        batchLimit: 5_000
      });

      expect(result.purged).toBe(0);
      expect(result.trimmed).toBeGreaterThanOrEqual(2);
      const survivors = await admin<{ external_id: string }[]>`
        select external_id from connector_records where instance_id = ${instance.id} order by external_id`;
      expect(survivors.map((row) => row.external_id)).toEqual(["exec_3", "exec_4"]);
    });
  });
});

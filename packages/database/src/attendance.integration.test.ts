import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenant, type DatabaseClient } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
// Skipping locally is a convenience; skipping in CI would mean these guarantees ship unproven.
if (process.env.CI && !(databaseUrl && adminDatabaseUrl))
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required in CI");
const suite = databaseUrl && adminDatabaseUrl ? describe : describe.skip;

/**
 * What the working time record promises, proven against PostgreSQL rather than against the
 * service that is supposed to call it.
 *
 * Every rule here is one somebody could otherwise reach around: a direct `update`, an entry
 * backdated without saying why, a correction pointed at somebody else's day. The domain refuses
 * all of them too, but the domain is only the polite door.
 */
suite("attendance schema", () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const membershipOther = randomUUID();

  const clockIn = (tx: postgres.TransactionSql, id: string, tenantId: string, membershipId: string) =>
    tx`insert into attendance_events (id, tenant_id, membership_id, kind, recorded_by_membership_id)
       values (${id}, ${tenantId}, ${membershipId}, 'clock_in', ${membershipId})`;

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    admin = createDatabaseClient(adminDatabaseUrl!);

    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
      (${userA}, 'Attendance Test A', ${`${userA}@test.local`}, true, now(), now()),
      (${userB}, 'Attendance Test B', ${`${userB}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values
      (${tenantA}, ${`att-a-${tenantA}`}, 'Att A'), (${tenantB}, ${`att-b-${tenantB}`}, 'Att B')`;
    await admin`insert into memberships (id, tenant_id, user_id) values
      (${membershipA}, ${tenantA}, ${userA}), (${membershipB}, ${tenantA}, ${userB}),
      (${membershipOther}, ${tenantB}, ${userA})`;
  });

  afterAll(async () => {
    await admin`set session_replication_role = 'replica'`;
    try {
      await admin`delete from attendance_events where tenant_id in (${tenantA}, ${tenantB})`;
    } finally {
      await admin`set session_replication_role = 'origin'`;
    }
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from "user" where id in (${userA}, ${userB})`;
    await database.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("keeps one tenant's record out of another's reach", async () => {
    const own = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, own, tenantA, membershipA));
    const seenByB = await withTenant(database, tenantB, (tx) => tx`select id from attendance_events where id = ${own}`);
    expect(seenByB).toHaveLength(0);
  });

  /**
   * The principal threat of the module, and it includes the employer. A record the company can
   * rewrite in silence proves nothing, so neither the trigger nor the grants allow it: the
   * application role has `select` and `insert` and nothing else.
   */
  it("refuses to change or delete an entry, even with direct SQL", async () => {
    const id = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, id, tenantA, membershipA));

    await expect(
      withTenant(database, tenantA, (tx) => tx`update attendance_events set kind = 'clock_out' where id = ${id}`)
    ).rejects.toThrow();
    await expect(
      withTenant(database, tenantA, (tx) => tx`delete from attendance_events where id = ${id}`)
    ).rejects.toThrow();

    const [survivor] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ kind: string }[]>`select kind from attendance_events where id = ${id}`
    );
    expect(survivor!.kind).toBe("clock_in");
  });

  it("refuses an entry that claims to have happened in the future", async () => {
    await expect(
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into attendance_events
          (id, tenant_id, membership_id, kind, occurred_at, recorded_by_membership_id, reason)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, 'clock_in', now() + interval '1 hour',
            ${membershipA}, 'Ho deixo apuntat')`
      )
    ).rejects.toThrow();
  });

  /**
   * The two clocks of an ordinary punch have to come out identical, or every single punch would
   * trip the rule below and demand a reason. That is why neither column is written from the
   * application: both take the transaction's `now()`.
   */
  it("gives a plain punch the same time on both clocks", async () => {
    const id = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, id, tenantA, membershipA));
    const [row] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ same: boolean }[]>`select occurred_at = recorded_at as same from attendance_events where id = ${id}`
    );
    expect(row!.same).toBe(true);
  });

  it("demands a reason for anything written after the fact", async () => {
    const backdated = (reason: string | null) =>
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into attendance_events
          (id, tenant_id, membership_id, kind, occurred_at, recorded_by_membership_id, reason)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, 'pause_end', now() - interval '3 hours',
            ${membershipA}, ${reason})`
      );

    await expect(backdated(null)).rejects.toThrow();
    await expect(backdated("   ")).rejects.toThrow();
    await expect(backdated("Vaig tornar del metge a les 13:00 i no ho vaig marcar")).resolves.toBeDefined();
  });

  it("lets a correction be recorded by somebody else, and says who", async () => {
    const original = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, original, tenantA, membershipA));
    await withTenant(
      database,
      tenantA,
      (tx) => tx`insert into attendance_events
        (id, tenant_id, membership_id, kind, occurred_at, corrects_event_id, recorded_by_membership_id, reason)
        values (${randomUUID()}, ${tenantA}, ${membershipA}, 'clock_in', now() - interval '2 hours',
          ${original}, ${membershipB}, 'Va entrar a les 08:00')`
    );

    const [correction] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ recorded_by_membership_id: string }[]>`
        select recorded_by_membership_id from attendance_events where corrects_event_id = ${original}`
    );
    // The record of whose day it is and the record of who wrote it are different facts, and an
    // inspection cares about the second one.
    expect(correction!.recorded_by_membership_id).toBe(membershipB);
  });

  /**
   * Two corrections on one original would retire it once and count twice, and the day would come
   * out doubled. Correcting a correction is still allowed, which is how a rectification is made.
   */
  it("refuses a second correction of the same entry", async () => {
    const original = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, original, tenantA, membershipA));
    const correct = () =>
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into attendance_events
          (id, tenant_id, membership_id, kind, occurred_at, corrects_event_id, recorded_by_membership_id, reason)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, 'clock_in', now() - interval '1 hour',
            ${original}, ${membershipA}, 'Hora equivocada')`
      );

    await expect(correct()).resolves.toBeDefined();
    await expect(correct()).rejects.toThrow();
  });

  it("refuses a correction pointed at another person's entry", async () => {
    const hers = randomUUID();
    await withTenant(database, tenantA, (tx) => clockIn(tx, hers, tenantA, membershipB));
    await expect(
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into attendance_events
          (id, tenant_id, membership_id, kind, occurred_at, corrects_event_id, recorded_by_membership_id, reason)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, 'clock_in', now() - interval '1 hour',
            ${hers}, ${membershipA}, 'No era meu')`
      )
    ).rejects.toThrow();
  });

  it("refuses an entry against a membership of another tenant", async () => {
    await expect(
      withTenant(database, tenantA, (tx) => clockIn(tx, randomUUID(), tenantA, membershipOther))
    ).rejects.toThrow();
  });

  it("swallows a retried punch instead of recording it twice", async () => {
    const reference = `retry-${randomUUID()}`;
    const punch = () =>
      withTenant(
        database,
        tenantA,
        (tx) => tx`insert into attendance_events
          (id, tenant_id, membership_id, kind, recorded_by_membership_id, client_reference)
          values (${randomUUID()}, ${tenantA}, ${membershipA}, 'clock_out', ${membershipA}, ${reference})`
      );

    await expect(punch()).resolves.toBeDefined();
    await expect(punch()).rejects.toThrow();
  });

  it("ships with pauses off and a retention period that is configuration, not a constant", async () => {
    await admin`insert into tenant_settings (tenant_id, brand_name) values (${tenantA}, 'Att A')`;
    const [settings] = await withTenant(
      database,
      tenantA,
      (tx) => tx<{ attendance_pauses_enabled: boolean; attendance_retention_years: number }[]>`
        select attendance_pauses_enabled, attendance_retention_years from tenant_settings where tenant_id = ${tenantA}`
    );
    expect(settings!.attendance_pauses_enabled).toBe(false);
    expect(settings!.attendance_retention_years).toBe(4);
  });
});

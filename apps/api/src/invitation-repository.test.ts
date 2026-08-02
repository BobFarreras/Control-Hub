import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";
import { acceptInvitation, createInvitation, hashInvitationToken, listInvitations, lookupInvitation } from "./invitation-repository.js";

describe("invitation tokens", () => {
  it("hashes tokens deterministically without retaining the raw value", () => {
    expect(hashInvitationToken("example-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInvitationToken("example-token")).toBe(hashInvitationToken("example-token"));
    expect(hashInvitationToken("different-token")).not.toBe(hashInvitationToken("example-token"));
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const suite = databaseUrl && adminDatabaseUrl ? describe : describe.skip;

suite("member invitations", () => {
  let database: DatabaseClient; let admin: DatabaseClient;
  const tenantId = randomUUID(); const otherTenantId = randomUUID(); const inviterId = randomUUID(); const inviteeId = randomUUID();
  const context: TenantContext = { tenantId, membershipId: randomUUID(), userId: inviterId, roles: ["owner"], permissions: ["members:manage"], mfaEnabled: true };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!); admin = createDatabaseClient(adminDatabaseUrl!);
    await admin`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values (${inviterId}, 'Inviter', ${`inviter-${inviterId}@test.local`}, true, now(), now()), (${inviteeId}, 'Invitee', ${`invitee-${inviteeId}@test.local`}, true, now(), now())`;
    await admin`insert into tenants (id, slug, name) values (${tenantId}, ${`invite-${tenantId}`}, 'Invitation Tenant'), (${otherTenantId}, ${`other-${otherTenantId}`}, 'Other Tenant')`;
    await admin`insert into roles (id, tenant_id, code, name) values (${randomUUID()}, ${tenantId}, 'technical', 'Technical')`;
  });

  afterAll(async () => {
    await admin`alter table audit_log disable trigger audit_log_append_only`;
    try { await admin`delete from audit_log where tenant_id in (${tenantId}, ${otherTenantId})`; }
    finally { await admin`alter table audit_log enable trigger audit_log_append_only`; }
    await admin`delete from tenants where id in (${tenantId}, ${otherTenantId})`;
    await admin`delete from "user" where id in (${inviterId}, ${inviteeId})`;
    await database.end({ timeout: 5 }); await admin.end({ timeout: 5 });
  });

  it("isolates, resolves and consumes a one-use token", async () => {
    const created = await createInvitation(database, context, { email: `invitee-${inviteeId}@test.local`, role: "technical", expiresAt: new Date(Date.now() + 60_000) });
    const stored = await admin<{ token_hash: string }[]>`select token_hash from member_invitations where id = ${created.id}`;
    expect(stored[0]?.token_hash).toBe(hashInvitationToken(created.token)); expect(stored[0]?.token_hash).not.toContain(created.token);
    expect(await listInvitations(database, { ...context, tenantId: otherTenantId })).toHaveLength(0);
    expect((await lookupInvitation(database, created.token)).tenantId).toBe(tenantId);
    await acceptInvitation(database, created.token, inviteeId, created.email);
    await expect(lookupInvitation(database, created.token)).rejects.toThrow("INVITATION_INVALID");
  });
});

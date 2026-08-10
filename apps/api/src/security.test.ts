import { rolePermissions, type Permission, type RoleCode, type TenantContext } from "@control-hub/domain";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ControlHubAuth } from "./auth.js";
import { ApiSecurityError, requirePermission, resolveTenantContext } from "./security.js";

const membershipRow = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  membership_id: "22222222-2222-4222-8222-222222222222",
  role: "owner",
  permission: "leads:read"
};

/** A tagged-template stand-in for the postgres client: it only ever returns the given rows. */
const databaseReturning = (rows: unknown[]) => vi.fn().mockResolvedValue(rows) as never;

const authFor = (user: { id: string; twoFactorEnabled?: boolean } | null) =>
  ({ api: { getSession: () => Promise.resolve(user ? { user } : null) } }) as unknown as ControlHubAuth;

const request = { headers: {} } as FastifyRequest;

const contextWith = (overrides: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: "tenant",
  membershipId: "membership",
  userId: "user",
  roles: ["owner"],
  permissions: ["leads:read"],
  mfaEnabled: true,
  ...overrides
});

describe("second factor policy", () => {
  it("refuses a session without a second factor", async () => {
    await expect(
      resolveTenantContext(
        authFor({ id: "user", twoFactorEnabled: false }),
        databaseReturning([membershipRow]),
        request
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "MFA_REQUIRED" });
  });

  it("accepts a session that carries one", async () => {
    const context = await resolveTenantContext(
      authFor({ id: "user", twoFactorEnabled: true }),
      databaseReturning([membershipRow]),
      request
    );
    expect(context.mfaEnabled).toBe(true);
    expect(context.tenantId).toBe(membershipRow.tenant_id);
  });

  it("lets an unenrolled member reach the routes that let them enrol", async () => {
    const context = await resolveTenantContext(
      authFor({ id: "user", twoFactorEnabled: false }),
      databaseReturning([membershipRow]),
      request,
      { allowWithoutSecondFactor: true }
    );
    expect(context.mfaEnabled).toBe(false);
  });

  it("still refuses an anonymous caller on an enrolment route", async () => {
    await expect(
      resolveTenantContext(authFor(null), databaseReturning([]), request, { allowWithoutSecondFactor: true })
    ).rejects.toMatchObject({ statusCode: 401, code: "AUTHENTICATION_REQUIRED" });
  });

  it("refuses a member of no active tenant", async () => {
    await expect(
      resolveTenantContext(authFor({ id: "user", twoFactorEnabled: true }), databaseReturning([]), request)
    ).rejects.toMatchObject({ statusCode: 403, code: "TENANT_ACCESS_DENIED" });
  });
});

describe("requirePermission", () => {
  it("allows a permission the membership holds", () => {
    expect(() => requirePermission(contextWith(), "leads:read")).not.toThrow();
  });

  it("denies one it does not", () => {
    expect(() => requirePermission(contextWith(), "members:manage")).toThrow(ApiSecurityError);
  });

  it("reports a denied permission as PERMISSION_DENIED, not as a missing factor", () => {
    // The second factor is settled before this point; conflating the two would tell a user to
    // set up MFA when the real answer is that their role does not grant the action.
    try {
      requirePermission(contextWith({ mfaEnabled: false, permissions: [] }), "members:manage");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiSecurityError);
      expect((error as ApiSecurityError).code).toBe("PERMISSION_DENIED");
    }
  });
});

describe("support permissions", () => {
  // The matrix in docs/specifications/permissions.md is the contract; this is what holds the
  // code to it. support:configure changes what counts as a breach, so it does not belong to
  // whoever merely resolves tickets.
  const held = (role: RoleCode, permission: Permission) => rolePermissions[role].includes(permission);

  it("lets every role read and work tickets", () => {
    for (const role of ["owner", "administrator", "technical"] as RoleCode[]) {
      expect(held(role, "tickets:read"), `${role} tickets:read`).toBe(true);
      expect(held(role, "tickets:manage"), `${role} tickets:manage`).toBe(true);
    }
  });

  it("keeps the support configuration away from the technical role", () => {
    expect(held("owner", "support:configure")).toBe(true);
    expect(held("administrator", "support:configure")).toBe(true);
    expect(held("technical", "support:configure")).toBe(false);
  });
});

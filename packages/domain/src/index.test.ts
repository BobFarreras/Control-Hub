import { describe, expect, it } from "vitest";
import {
  canTransitionLead,
  hasPermission,
  normalizeComparableName,
  normalizeEmail,
  normalizePhone,
  permissionCodes,
  rolePermissions,
  type TenantContext
} from "./index.js";

describe("CRM domain", () => {
  it("permits direct movement inside the active pipeline but keeps terminal states closed", () => {
    expect(canTransitionLead("new", "contacted")).toBe(true);
    expect(canTransitionLead("contacted", "new")).toBe(true);
    expect(canTransitionLead("won", "lost")).toBe(false);
    expect(canTransitionLead("proposal", "won")).toBe(false);
  });

  it("normalizes strong duplicate keys", () => {
    expect(normalizeEmail(" Sales@Example.COM ")).toBe("sales@example.com");
    expect(normalizePhone("+34 600-123-456")).toBe("+34600123456");
    expect(normalizeComparableName("Àvant  Business, S.L.")).toBe("avant business s l");
  });

  it("grants technical users CRM read access without write access", () => {
    expect(rolePermissions.technical).toContain("customers:read");
    expect(rolePermissions.technical).toContain("leads:read");
    expect(rolePermissions.technical).not.toContain("customers:manage");
    expect(rolePermissions.technical).not.toContain("leads:manage");
  });
});

function context(roles: TenantContext["roles"], permissions: TenantContext["permissions"]): TenantContext {
  return { tenantId: "tenant-a", membershipId: "member-a", userId: "user-a", roles, permissions, mfaEnabled: true };
}

describe("RBAC", () => {
  // Compared against the list itself rather than a count: a hardcoded number only says that
  // somebody added a permission, not whether the owner actually got it.
  it("grants the owner every declared permission", () => expect(rolePermissions.owner).toEqual(permissionCodes));
  it("keeps credential rotation away from administrators", () =>
    expect(rolePermissions.administrator).not.toContain("credentials:rotate"));
  it("allows technical infrastructure operation but not tenant management", () => {
    expect(rolePermissions.technical).toContain("infrastructure:operate");
    expect(rolePermissions.technical).not.toContain("tenant:manage");
  });
  it("denies permissions absent from the resolved membership", () =>
    expect(hasPermission(context(["owner"], []), "tenant:manage")).toBe(false));
});

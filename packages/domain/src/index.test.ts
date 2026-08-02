import { describe, expect, it } from "vitest";
import { hasPermission, rolePermissions, type TenantContext } from "./index.js";

function context(roles: TenantContext["roles"], permissions: TenantContext["permissions"]): TenantContext {
  return { tenantId: "tenant-a", membershipId: "member-a", userId: "user-a", roles, permissions, mfaEnabled: true };
}

describe("RBAC", () => {
  it("grants the owner every declared permission", () => expect(rolePermissions.owner).toHaveLength(18));
  it("keeps credential rotation away from administrators", () => expect(rolePermissions.administrator).not.toContain("credentials:rotate"));
  it("allows technical infrastructure operation but not tenant management", () => {
    expect(rolePermissions.technical).toContain("infrastructure:operate");
    expect(rolePermissions.technical).not.toContain("tenant:manage");
  });
  it("denies permissions absent from the resolved membership", () => expect(hasPermission(context(["owner"], []), "tenant:manage")).toBe(false));
});

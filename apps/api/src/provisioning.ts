import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@control-hub/database";
import { rolePermissions, type RoleCode } from "@control-hub/domain";

/**
 * Creating the first tenant: settings, the full role table with its permissions, and the
 * Owner membership, in one transaction.
 *
 * It lives here rather than inside `bootstrap.ts` because the end to end seed has to produce
 * a tenant that is indistinguishable from an installed one. A second copy of this would drift,
 * and the tests would then be proving something about a tenant no customer ever has.
 *
 * The guards stay with the callers: this function provisions, it does not decide whether
 * provisioning is allowed.
 */
export async function provisionTenantWithOwner(
  database: DatabaseClient,
  input: { tenantId: string; slug: string; name: string; ownerUserId: string }
): Promise<{ membershipId: string }> {
  const membershipId = randomUUID();
  await database.begin(async (transaction) => {
    await transaction`insert into tenants (id, slug, name) values (${input.tenantId}, ${input.slug}, ${input.name})`;
    await transaction`select set_config('app.tenant_id', ${input.tenantId}, true)`;
    await transaction`insert into tenant_settings (tenant_id, brand_name) values (${input.tenantId}, ${input.name})`;
    await transaction`insert into memberships (id, tenant_id, user_id) values (${membershipId}, ${input.tenantId}, ${input.ownerUserId})`;
    for (const roleCode of Object.keys(rolePermissions) as RoleCode[]) {
      const roleId = randomUUID();
      await transaction`insert into roles (id, tenant_id, code, name) values (${roleId}, ${input.tenantId}, ${roleCode}, ${roleCode})`;
      for (const permission of rolePermissions[roleCode])
        await transaction`insert into role_permissions (role_id, permission_code) values (${roleId}, ${permission})`;
      if (roleCode === "owner")
        await transaction`insert into membership_roles (membership_id, role_id) values (${membershipId}, ${roleId})`;
    }
  });
  return { membershipId };
}

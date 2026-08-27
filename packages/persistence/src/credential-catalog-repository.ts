import { randomUUID } from "node:crypto";
import {
  CredentialCatalogError,
  type CreateCredentialCatalogEntryPersistence,
  type CredentialCatalogEntryRecord,
  type CredentialCatalogRepository,
  type CredentialCatalogVisibility,
  type PasswordManagerInstallationRecord
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { CredentialCatalogStatus, TenantContext } from "@control-hub/domain";
import type postgres from "postgres";

type DatabaseError = { code?: string };

const installationColumns = `id, display_name as "displayName", provider, base_url as "baseUrl",
  deployment_mode as "deploymentMode", status, last_reviewed_at as "lastReviewedAt", version,
  created_at as "createdAt", updated_at as "updatedAt"`;

// Deliberately excludes reference_key_id, reference_nonce and reference_ciphertext. This adapter
// writes the envelope but its public read methods cannot accidentally return it.
const entryColumns = `id, installation_id as "installationId", client_id as "clientId",
  company_subscription_id as "companySubscriptionId", application_name as "applicationName",
  category, environment, account_label as "accountLabel", owner_membership_id as "ownerMembershipId",
  status, review_due_at as "reviewDueAt", last_reviewed_at as "lastReviewedAt", version,
  created_at as "createdAt", updated_at as "updatedAt"`;

function mapConstraint(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (["23503", "23505", "23514", "22P02"].includes(databaseError.code ?? ""))
    throw new CredentialCatalogError("INVALID_INPUT");
  throw error;
}

function visibilityClause(tx: postgres.TransactionSql, visibility: CredentialCatalogVisibility) {
  return visibility.mode === "all" ? tx`` : tx`and owner_membership_id = ${visibility.membershipId}`;
}

export class PostgresCredentialCatalogRepository implements CredentialCatalogRepository {
  constructor(private readonly database: DatabaseClient) {}

  createInstallation(
    context: TenantContext,
    input: {
      id: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerInstallationRecord["deploymentMode"];
      status: PasswordManagerInstallationRecord["status"];
      createdByMembershipId: string;
    }
  ): Promise<PasswordManagerInstallationRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [record] = await tx<PasswordManagerInstallationRecord[]>`
        insert into password_manager_installations
          (id, tenant_id, display_name, base_url, deployment_mode, status, created_by_membership_id)
        values (${input.id}, ${context.tenantId}, ${input.displayName}, ${input.baseUrl},
          ${input.deploymentMode}, ${input.status}, ${input.createdByMembershipId})
        returning ${tx.unsafe(installationColumns)}`;
      return record!;
    }).catch(mapConstraint);
  }

  listInstallations(context: TenantContext): Promise<PasswordManagerInstallationRecord[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) =>
        tx<PasswordManagerInstallationRecord[]>`
        select ${tx.unsafe(installationColumns)} from password_manager_installations
        where tenant_id = ${context.tenantId}
        order by display_name asc, id asc`
    );
  }

  getInstallation(context: TenantContext, installationId: string): Promise<PasswordManagerInstallationRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [record] = await tx<PasswordManagerInstallationRecord[]>`
        select ${tx.unsafe(installationColumns)} from password_manager_installations
        where tenant_id = ${context.tenantId} and id = ${installationId}`;
      return record ?? null;
    });
  }
  updateInstallation(
    context: TenantContext,
    input: {
      installationId: string;
      displayName: string;
      baseUrl: string;
      deploymentMode: PasswordManagerInstallationRecord["deploymentMode"];
      status: PasswordManagerInstallationRecord["status"];
      expectedVersion: number;
    }
  ): Promise<PasswordManagerInstallationRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [record] = await tx<PasswordManagerInstallationRecord[]>`update password_manager_installations
        set display_name=${input.displayName}, base_url=${input.baseUrl}, deployment_mode=${input.deploymentMode}, status=${input.status}, version=version+1, updated_at=now()
        where tenant_id=${context.tenantId} and id=${input.installationId} and version=${input.expectedVersion}
        returning ${tx.unsafe(installationColumns)}`;
      return record ?? null;
    }).catch(mapConstraint);
  }

  createEntry(
    context: TenantContext,
    input: CreateCredentialCatalogEntryPersistence
  ): Promise<CredentialCatalogEntryRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<CredentialCatalogEntryRecord[]>`
        insert into credential_catalog_entries
          (id, tenant_id, installation_id, client_id, company_subscription_id, application_name,
           category, environment, account_label, owner_membership_id, reference_key_id,
           reference_nonce, reference_ciphertext, review_due_at, created_by_membership_id)
        values (${input.id}, ${context.tenantId}, ${input.installationId}, ${input.clientId},
          ${input.companySubscriptionId}, ${input.applicationName}, ${input.category}, ${input.environment},
          ${input.accountLabel}, ${input.ownerMembershipId}, ${input.reference.keyId},
          ${Buffer.from(input.reference.nonce)}, ${Buffer.from(input.reference.ciphertext)},
          ${input.reviewDueAt}, ${input.createdByMembershipId})
        returning ${tx.unsafe(entryColumns)}`;
      await tx`
        insert into credential_catalog_events
          (id, tenant_id, entry_id, actor_membership_id, event_type, changes)
        values (${randomUUID()}, ${context.tenantId}, ${input.id}, ${input.createdByMembershipId},
          'created', ${tx.json({ fields: ["applicationName", "category", "environment", "ownerMembershipId"] })})`;
      return entry!;
    }).catch(mapConstraint);
  }

  listEntries(
    context: TenantContext,
    visibility: CredentialCatalogVisibility
  ): Promise<CredentialCatalogEntryRecord[]> {
    return withTenant(this.database, context.tenantId, (tx) => {
      const scope = visibilityClause(tx, visibility);
      return tx<CredentialCatalogEntryRecord[]>`
        select ${tx.unsafe(entryColumns)} from credential_catalog_entries
        where tenant_id = ${context.tenantId} ${scope}
        order by application_name asc, id asc`;
    });
  }

  getEntry(
    context: TenantContext,
    entryId: string,
    visibility: CredentialCatalogVisibility
  ): Promise<CredentialCatalogEntryRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const scope = visibilityClause(tx, visibility);
      const [entry] = await tx<CredentialCatalogEntryRecord[]>`
        select ${tx.unsafe(entryColumns)} from credential_catalog_entries
        where tenant_id = ${context.tenantId} and id = ${entryId} ${scope}`;
      return entry ?? null;
    });
  }

  transitionEntry(
    context: TenantContext,
    input: {
      entryId: string;
      from: CredentialCatalogStatus;
      to: CredentialCatalogStatus;
      expectedVersion: number;
      actorMembershipId: string;
    }
  ): Promise<CredentialCatalogEntryRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<CredentialCatalogEntryRecord[]>`
        update credential_catalog_entries
        set status = ${input.to}, version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${input.entryId}
          and status = ${input.from} and version = ${input.expectedVersion}
        returning ${tx.unsafe(entryColumns)}`;
      if (!entry) return null;
      const eventType =
        input.to === "review_due"
          ? "marked_review_due"
          : input.to === "revoked"
            ? "revoked"
            : input.to === "archived"
              ? "archived"
              : "restored";
      await tx`
        insert into credential_catalog_events
          (id, tenant_id, entry_id, actor_membership_id, event_type, changes)
        values (${randomUUID()}, ${context.tenantId}, ${input.entryId}, ${input.actorMembershipId},
          ${eventType}, ${tx.json({ status: { from: input.from, to: input.to } })})`;
      return entry;
    }).catch(mapConstraint);
  }

  readReference(context: TenantContext, entryId: string) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [row] = await tx<{ keyId: string; nonce: Buffer; ciphertext: Buffer }[]>`
        select reference_key_id as "keyId", reference_nonce as nonce, reference_ciphertext as ciphertext
        from credential_catalog_entries where tenant_id = ${context.tenantId} and id = ${entryId}`;
      return row
        ? { keyId: row.keyId, nonce: new Uint8Array(row.nonce), ciphertext: new Uint8Array(row.ciphertext) }
        : null;
    });
  }

  recordOpen(context: TenantContext, entryId: string, actorMembershipId: string): Promise<void> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      await tx`insert into credential_catalog_events
        (id, tenant_id, entry_id, actor_membership_id, event_type, changes)
        values (${randomUUID()}, ${context.tenantId}, ${entryId}, ${actorMembershipId}, 'open_attempted', ${tx.json({ outcome: "success" })})`;
    });
  }

  reviewEntry(
    context: TenantContext,
    input: { entryId: string; expectedVersion: number; actorMembershipId: string; reviewedAt: Date }
  ): Promise<CredentialCatalogEntryRecord | null> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const [entry] = await tx<CredentialCatalogEntryRecord[]>`update credential_catalog_entries
        set last_reviewed_at=${input.reviewedAt}, status=case when status='review_due' then 'active' else status end,
          version=version+1, updated_at=now()
        where tenant_id=${context.tenantId} and id=${input.entryId} and version=${input.expectedVersion}
        returning ${tx.unsafe(entryColumns)}`;
      if (!entry) return null;
      await tx`insert into credential_catalog_events (id, tenant_id, entry_id, actor_membership_id, event_type, changes)
        values (${randomUUID()}, ${context.tenantId}, ${input.entryId}, ${input.actorMembershipId}, 'reviewed', ${tx.json({ fields: ["lastReviewedAt", "status"] })})`;
      return entry;
    });
  }
}

import type { CredentialCatalogService } from "@control-hub/application";
import { resolveTenantContext, writeAudit } from "../security.js";
import type { RouteContext } from "./context.js";

type CatalogContext = RouteContext & { credentials: CredentialCatalogService };
type EntryBody = {
  installationId?: string;
  clientId?: string | null;
  companySubscriptionId?: string | null;
  applicationName?: string;
  category?: "hosting" | "email" | "domain" | "website_admin" | "billing" | "social" | "infrastructure" | "other";
  environment?: "production" | "staging" | "development" | "other";
  accountLabel?: string | null;
  ownerMembershipId?: string;
  reviewDueAt?: string | null;
  opaqueReference?: string;
};

export function registerCredentialCatalogRoutes({ app, auth, database, credentials }: CatalogContext) {
  app.get(
    "/api/v1/password-manager/installations",
    { schema: { tags: ["credential-catalog"], summary: "List password manager installations" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return { installations: await credentials.listInstallations(context) };
    }
  );

  app.post<{
    Body: {
      displayName?: string;
      baseUrl?: string;
      deploymentMode?: "cloud" | "self_hosted_shared_vps" | "self_hosted_dedicated_vps";
      status?: "active" | "degraded" | "disabled";
    };
  }>(
    "/api/v1/password-manager/installations",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { tags: ["credential-catalog"], summary: "Register a Bitwarden installation" }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request, { requireFreshSession: true });
      try {
        const installation = await credentials.createInstallation(context, {
          displayName: request.body?.displayName ?? "",
          baseUrl: request.body?.baseUrl ?? "",
          deploymentMode: request.body?.deploymentMode ?? "cloud",
          ...(request.body?.status ? { status: request.body.status } : {})
        });
        await writeAudit(database, context, request, {
          action: "password_manager.installation.create",
          targetType: "password_manager_installation",
          targetId: installation.id,
          outcome: "success"
        });
        return reply.code(201).send(installation);
      } catch (error) {
        await writeAudit(database, context, request, {
          action: "password_manager.installation.create",
          targetType: "password_manager_installation",
          outcome: "denied"
        });
        throw error;
      }
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      displayName?: string;
      baseUrl?: string;
      deploymentMode?: "cloud" | "self_hosted_shared_vps" | "self_hosted_dedicated_vps";
      status?: "active" | "degraded" | "disabled";
      version?: number;
    };
  }>(
    "/api/v1/password-manager/installations/:id",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { tags: ["credential-catalog"], summary: "Update a Bitwarden installation" }
    },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request, { requireFreshSession: true });
      return credentials.updateInstallation(context, {
        installationId: request.params.id,
        displayName: request.body?.displayName ?? "",
        baseUrl: request.body?.baseUrl ?? "",
        deploymentMode: request.body?.deploymentMode ?? "cloud",
        status: request.body?.status ?? "disabled",
        expectedVersion: request.body?.version ?? -1
      });
    }
  );

  app.get(
    "/api/v1/credential-catalog",
    { schema: { tags: ["credential-catalog"], summary: "List visible credential entries" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return { entries: await credentials.listEntries(context) };
    }
  );

  app.post<{ Body: EntryBody }>(
    "/api/v1/credential-catalog",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags: ["credential-catalog"], summary: "Create a credential catalogue entry" }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request);
      const body = request.body ?? {};
      const entry = await credentials.createEntry(context, {
        installationId: body.installationId ?? "",
        clientId: body.clientId ?? null,
        companySubscriptionId: body.companySubscriptionId ?? null,
        applicationName: body.applicationName ?? "",
        category: body.category ?? "other",
        environment: body.environment ?? "other",
        accountLabel: body.accountLabel ?? null,
        ownerMembershipId: body.ownerMembershipId ?? "",
        reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
        opaqueReference: body.opaqueReference ?? ""
      });
      return reply.code(201).send(entry);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/credential-catalog/:id",
    { schema: { tags: ["credential-catalog"], summary: "Read a visible credential entry" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return credentials.getEntry(context, request.params.id);
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { status?: "active" | "review_due" | "revoked" | "archived"; version?: number };
  }>(
    "/api/v1/credential-catalog/:id",
    { schema: { tags: ["credential-catalog"], summary: "Transition a credential entry" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return credentials.transitionEntry(context, {
        entryId: request.params.id,
        status: request.body?.status ?? "active",
        expectedVersion: request.body?.version ?? -1
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/credential-catalog/:id/open-intents",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute", ban: 3 } },
      schema: { tags: ["credential-catalog"], summary: "Create a guarded Bitwarden navigation instruction" }
    },
    async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request, { requireFreshSession: true });
      try {
        const result = await credentials.openEntry(context, request.params.id);
        await writeAudit(database, context, request, {
          action: "credential_catalog.open",
          targetType: "credential_catalog_entry",
          targetId: request.params.id,
          outcome: "success"
        });
        return reply.header("Cache-Control", "no-store").header("Pragma", "no-cache").send(result);
      } catch (error) {
        await writeAudit(database, context, request, {
          action: "credential_catalog.open",
          targetType: "credential_catalog_entry",
          targetId: request.params.id,
          outcome: "denied"
        });
        throw error;
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { version?: number } }>(
    "/api/v1/credential-catalog/:id/archive",
    { schema: { tags: ["credential-catalog"], summary: "Archive a credential entry" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return credentials.transitionEntry(context, {
        entryId: request.params.id,
        status: "archived",
        expectedVersion: request.body?.version ?? -1
      });
    }
  );

  app.post<{ Params: { id: string }; Body: { version?: number } }>(
    "/api/v1/credential-catalog/:id/reviews",
    { schema: { tags: ["credential-catalog"], summary: "Confirm a credential metadata review" } },
    async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      return credentials.reviewEntry(context, request.params.id, request.body?.version ?? -1);
    }
  );
}

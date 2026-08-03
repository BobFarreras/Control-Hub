import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { LogController, type FastifyRequest } from "fastify";
import Redis from "ioredis";
import { checkDatabase, createDatabaseClient } from "@control-hub/database";
import { createLogger } from "@control-hub/observability";
import { parseCsv, stringifyCsv, type LiveHealth, type ReadyHealth } from "@control-hub/contracts";
import type { ControlHubAuth } from "./auth.js";
import { ApiSecurityError, requirePermission, resolveTenantContext } from "./security.js";
import { assignMemberRole, IdentityInvariantError, listAuditEvents, listMembers } from "./identity-repository.js";
import { writeAudit } from "./security.js";
import type { RoleCode } from "@control-hub/domain";
import { leadPriorities, leadStatuses, normalizeComparableName, type LeadPriority, type LeadStatus } from "@control-hub/domain";
import { CommerceError, CommerceService, CompanySubscriptionError, CompanySubscriptionService, CrmError, CrmService, type CrmListQuery, type CreateLeadInput } from "@control-hub/application";
import { PostgresCrmRepository } from "./crm-repository.js";
import { PostgresCommerceRepository } from "./commerce-repository.js";
import { PostgresCompanySubscriptionRepository } from "./company-subscription-repository.js";
import { acceptInvitation, createInvitation, InvitationError, listInvitations, lookupInvitation, revokeInvitation, type InvitationRole } from "./invitation-repository.js";
import { getTablePreference, saveTablePreference } from "./table-preference-repository.js";
import type { MailSender } from "./email.js";

type BuildAppOptions = { databaseUrl: string; redisUrl: string; appOrigin?: string; auth?: ControlHubAuth; invitationAuth?: ControlHubAuth; sendMail?: MailSender; logLevel?: string; version?: string; exposeApiDocs?: boolean };

/**
 * Credential endpoints are the ones worth throttling hard: they are the brute force surface.
 * Everything else under the auth prefix is session bookkeeping, and `get-session` in
 * particular runs once per rendered page, so it must not share a strict budget with sign-in.
 */
const sensitiveAuthPrefixes = ["/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/forget-password", "/api/auth/reset-password", "/api/auth/two-factor", "/api/auth/passkey"];

export function isSensitiveAuthRequest(request: FastifyRequest) {
  const path = request.url.split("?")[0] ?? "";
  return sensitiveAuthPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Server rendered pages call this API from the web container, so every authenticated user
 * shares one source address. Keying the limiter on the session token instead gives each
 * user their own budget regardless of how many proxies sit in between; unauthenticated
 * traffic still falls back to the address, which is what brute force protection needs.
 */
export function rateLimitKey(request: FastifyRequest) {
  const cookieHeader = request.headers.cookie;
  // A caller choosing its own cookie also chooses its own bucket, so credential routes must
  // never be keyed on it: rotating a fake token would hand out a fresh budget every attempt.
  if (cookieHeader && !isSensitiveAuthRequest(request)) {
    for (const part of cookieHeader.split(";")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      if (name !== "better-auth.session_token" && name !== "__Secure-better-auth.session_token") continue;
      const value = part.slice(separator + 1).trim();
      if (value) return `session:${createHash("sha256").update(value).digest("hex")}`;
    }
  }
  return `ip:${request.ip}`;
}

const tableColumns = {
  "crm.leads": ["name", "company", "status", "priority", "created", "actions"],
  "crm.customers": ["name", "email", "phone", "status", "created"]
} as const;
type TableId = keyof typeof tableColumns;

function requestHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) if (value) result.set(name, Array.isArray(value) ? value.join(",") : value);
  return result;
}

function invitationMessage(locale: "ca" | "es" | "en", url: string) {
  if (locale === "es") return { subject: "Control Hub - Invitacion", text: `Has recibido una invitacion a Control Hub. El enlace caduca en 48 horas: ${url}` };
  if (locale === "en") return { subject: "Control Hub - Invitation", text: `You have been invited to Control Hub. This link expires in 48 hours: ${url}` };
  return { subject: "Control Hub - Invitacio", text: `Has rebut una invitacio a Control Hub. L'enllac caduca en 48 hores: ${url}` };
}

export function buildApp(options: BuildAppOptions) {
  const logger = createLogger("control-hub-api", options.logLevel);
  const app = Fastify({ loggerInstance: logger, trustProxy: true, requestIdHeader: "x-request-id", logController: new LogController({ disableRequestLogging: true }) });
  const database = createDatabaseClient(options.databaseUrl);
  const crm = new CrmService(new PostgresCrmRepository(database));
  const commerce = new CommerceService(new PostgresCommerceRepository(database));
  const companySubscriptions = new CompanySubscriptionService(new PostgresCompanySubscriptionRepository(database));
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => logger.warn({ err: error }, "queue connection unavailable"));

  void app.register(cors, { origin: options.appOrigin ?? false, credentials: Boolean(options.appOrigin), allowedHeaders: ["content-type", "x-control-hub-tenant", "x-request-id"] });
  void app.register(helmet, { contentSecurityPolicy: false });
  // No global `ban`: a ban on ordinary read traffic locks a user out of the whole product,
  // which is the failure this budget exists to prevent. Bans stay on the credential routes.
  void app.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: rateLimitKey });
  void app.register(swagger, { openapi: { info: { title: "Control Hub API", version: options.version ?? "0.1.0" } } });
  if (options.exposeApiDocs) void app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method) || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (origin && options.appOrigin && origin !== options.appOrigin) return reply.code(403).send({ code: "ORIGIN_DENIED" });
    if (request.headers.cookie && !origin) return reply.code(403).send({ code: "ORIGIN_REQUIRED" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiSecurityError) return reply.code(error.statusCode).send({ code: error.code, requestId: request.id });
    if (error instanceof IdentityInvariantError) return reply.code(error.message === "MEMBERSHIP_NOT_FOUND" ? 404 : 409).send({ code: error.message, requestId: request.id });
    if (error instanceof InvitationError) return reply.code(error.message === "INVITATION_NOT_FOUND" ? 404 : 409).send({ code: error.message, requestId: request.id });
    if (error instanceof CrmError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : error.code.startsWith("DUPLICATE") || error.code === "INVALID_TRANSITION" ? 409 : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CommerceError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : error.code === "DUPLICATE_CODE" || error.code === "INVALID_SUBSCRIPTION_TRANSITION" ? 409 : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    if (error instanceof CompanySubscriptionError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : error.code === "DUPLICATE_SUBSCRIPTION" ? 409 : 400;
      return reply.code(status).send({ code: error.code, requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ code: "INTERNAL_ERROR", requestId: request.id });
  });

  if (options.auth) {
    const auth = options.auth;
    app.route({ method: ["GET", "POST"], url: "/api/auth/*", config: { rateLimit: { max: (request) => isSensitiveAuthRequest(request) ? 10 : 240, timeWindow: "1 minute", ban: 20, keyGenerator: rateLimitKey } }, handler: async (request, reply) => {
      const url = new URL(request.url, options.appOrigin ?? "http://localhost:3001");
      const init: RequestInit = { method: request.method, headers: requestHeaders(request.headers) };
      if (request.method !== "GET" && request.body !== undefined) init.body = JSON.stringify(request.body);
      const response = await auth.handler(new Request(url, init));
      reply.code(response.status);
      response.headers.forEach((value, name) => { if (name !== "set-cookie") reply.header(name, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    }});

    app.get("/api/v1/me", async (request) => ({ context: await resolveTenantContext(auth, database, request) }));
    app.get<{ Params: { tableId: string } }>("/api/v1/table-preferences/:tableId", async (request) => { const context = await resolveTenantContext(auth, database, request); if (!Object.hasOwn(tableColumns, request.params.tableId)) throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED"); return { preference: await getTablePreference(database, context, request.params.tableId) }; });
    app.put<{ Params: { tableId: string }; Body: { columnOrder: string[]; hiddenColumns: string[]; columnWidths: Record<string, number>; pageSize: 10 | 25 | 50 | 100 } }>("/api/v1/table-preferences/:tableId", { schema: { body: { type: "object", additionalProperties: false, required: ["columnOrder", "hiddenColumns", "columnWidths", "pageSize"], properties: { columnOrder: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", maxLength: 80 } }, hiddenColumns: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", maxLength: 80 } }, columnWidths: { type: "object", maxProperties: 20, additionalProperties: { type: "integer", minimum: 80, maximum: 600 } }, pageSize: { type: "integer", enum: [10, 25, 50, 100] } } } } }, async (request) => { const context = await resolveTenantContext(auth, database, request); const tableId = request.params.tableId as TableId; if (!Object.hasOwn(tableColumns, tableId)) throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED"); const allowed = new Set<string>(tableColumns[tableId]); if ([...request.body.columnOrder, ...request.body.hiddenColumns, ...Object.keys(request.body.columnWidths)].some((column) => !allowed.has(column))) throw new ApiSecurityError(403, "TABLE_PREFERENCE_DENIED"); return { preference: await saveTablePreference(database, context, { tableId, ...request.body }) }; });
    app.get("/api/v1/sessions", async (request) => {
      await resolveTenantContext(auth, database, request);
      return { sessions: await auth.api.listSessions({ headers: requestHeaders(request.headers) }) };
    });
    app.get("/api/v1/members", async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "members:manage");
      return { members: await listMembers(database, context) };
    });
    app.patch<{ Params: { membershipId: string }; Body: { role: RoleCode } }>("/api/v1/members/:membershipId/role", { schema: { body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: ["owner", "administrator", "technical"] } } } } }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "roles:manage");
      await assignMemberRole(database, context, request.params.membershipId, request.body.role);
      await writeAudit(database, context, request, { action: "membership.role.changed", targetType: "membership", targetId: request.params.membershipId, outcome: "success", metadata: { role: request.body.role } });
      return { status: "updated" };
    });
    app.get("/api/v1/audit", async (request) => {
      const context = await resolveTenantContext(auth, database, request);
      requirePermission(context, "audit:read");
      return { events: await listAuditEvents(database, context) };
    });

    app.get("/api/v1/commerce/catalog", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "products:manage"); return commerce.catalog(context); });
    app.post<{ Body: { code: string; name: string; description?: string } }>("/api/v1/commerce/products", { schema: { body: { type: "object", additionalProperties: false, required: ["code", "name"], properties: { code: { type: "string", minLength: 3, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: "string", maxLength: 2000 } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "products:manage"); const product = await commerce.createProduct(context, request.body); await writeAudit(database, context, request, { action: "product.created", targetType: "product", targetId: product.id, outcome: "success" }); return reply.code(201).send({ product }); });
    app.post<{ Params: { productId: string }; Body: { version: string; status: "draft" | "active"; releasedAt?: string } }>("/api/v1/commerce/products/:productId/versions", { schema: { body: { type: "object", additionalProperties: false, required: ["version", "status"], properties: { version: { type: "string", minLength: 1, maxLength: 80 }, status: { type: "string", enum: ["draft", "active"] }, releasedAt: { type: "string", format: "date-time" } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "products:manage"); const version = await commerce.createVersion(context, request.params.productId, { version: request.body.version, status: request.body.status, ...(request.body.releasedAt ? { releasedAt: new Date(request.body.releasedAt) } : {}) }); await writeAudit(database, context, request, { action: "product.version.created", targetType: "product_version", targetId: version.id, outcome: "success" }); return reply.code(201).send({ version }); });
    app.post<{ Params: { versionId: string }; Body: { code: string; name: string; description?: string } }>("/api/v1/commerce/versions/:versionId/plans", { schema: { body: { type: "object", additionalProperties: false, required: ["code", "name"], properties: { code: { type: "string", minLength: 3, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: "string", maxLength: 2000 } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "products:manage"); const plan = await commerce.createPlan(context, request.params.versionId, request.body); await writeAudit(database, context, request, { action: "plan.created", targetType: "plan", targetId: plan.id, outcome: "success" }); return reply.code(201).send({ plan }); });
    app.post<{ Params: { planId: string }; Body: { currency: string; amountMinor: number; costMinor: number; taxBasisPoints: number; interval: "free" | "monthly" | "quarterly" | "semiannual" | "annual"; effectiveFrom?: string } }>("/api/v1/commerce/plans/:planId/prices", { schema: { body: { type: "object", additionalProperties: false, required: ["currency", "amountMinor", "costMinor", "taxBasisPoints", "interval"], properties: { currency: { type: "string", pattern: "^[A-Za-z]{3}$" }, amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 }, costMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 }, taxBasisPoints: { type: "integer", minimum: 0, maximum: 10000 }, interval: { type: "string", enum: ["free", "monthly", "quarterly", "semiannual", "annual"] }, effectiveFrom: { type: "string", format: "date-time" } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "products:manage"); const price = await commerce.createPrice(context, request.params.planId, { currency: request.body.currency, amountMinor: request.body.amountMinor, costMinor: request.body.costMinor, taxBasisPoints: request.body.taxBasisPoints, interval: request.body.interval, ...(request.body.effectiveFrom ? { effectiveFrom: new Date(request.body.effectiveFrom) } : {}) }); await writeAudit(database, context, request, { action: "plan.price.published", targetType: "plan_price", targetId: price.id, outcome: "success", metadata: { currency: price.currency, amountMinor: price.amountMinor } }); return reply.code(201).send({ price }); });
    app.get("/api/v1/commerce/subscriptions", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); return { subscriptions: await commerce.listSubscriptions(context) }; });
    app.post<{ Body: { customerId: string; planId: string; priceId: string; quantity: number; startedAt?: string; renewalAt?: string; renewalAlertDays?: number } }>("/api/v1/commerce/subscriptions", { schema: { body: { type: "object", additionalProperties: false, required: ["customerId", "planId", "priceId", "quantity"], properties: { customerId: { type: "string", format: "uuid" }, planId: { type: "string", format: "uuid" }, priceId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 1000000 }, startedAt: { type: "string", format: "date-time" }, renewalAt: { type: "string", format: "date-time" }, renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await commerce.createSubscription(context, { customerId: request.body.customerId, planId: request.body.planId, priceId: request.body.priceId, quantity: request.body.quantity, ...(request.body.startedAt ? { startedAt: new Date(request.body.startedAt) } : {}), ...(request.body.renewalAt ? { renewalAt: new Date(request.body.renewalAt) } : {}), ...(request.body.renewalAlertDays !== undefined ? { renewalAlertDays: request.body.renewalAlertDays } : {}) }); await writeAudit(database, context, request, { action: "subscription.created", targetType: "subscription", targetId: subscription.id, outcome: "success" }); return reply.code(201).send({ subscription }); });
    app.patch<{ Params: { subscriptionId: string }; Body: { status: "active" | "paused" | "canceled"; effectiveAt?: string } }>("/api/v1/commerce/subscriptions/:subscriptionId/status", { schema: { body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["active", "paused", "canceled"] }, effectiveAt: { type: "string", format: "date-time" } } } } }, async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await commerce.transitionSubscription(context, request.params.subscriptionId, request.body.status, request.body.effectiveAt ? new Date(request.body.effectiveAt) : new Date()); await writeAudit(database, context, request, { action: `subscription.${request.body.status}`, targetType: "subscription", targetId: subscription.id, outcome: "success" }); return { subscription }; });
    app.patch<{ Params: { subscriptionId: string }; Body: { planId: string; priceId: string; effectiveAt?: string; renewalAt?: string } }>("/api/v1/commerce/subscriptions/:subscriptionId/plan", { schema: { body: { type: "object", additionalProperties: false, required: ["planId", "priceId"], properties: { planId: { type: "string", format: "uuid" }, priceId: { type: "string", format: "uuid" }, effectiveAt: { type: "string", format: "date-time" }, renewalAt: { type: "string", format: "date-time" } } } } }, async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await commerce.changePlan(context, request.params.subscriptionId, { planId: request.body.planId, priceId: request.body.priceId, ...(request.body.effectiveAt ? { effectiveAt: new Date(request.body.effectiveAt) } : {}), ...(request.body.renewalAt ? { renewalAt: new Date(request.body.renewalAt) } : {}) }); await writeAudit(database, context, request, { action: "subscription.plan.changed", targetType: "subscription", targetId: subscription.id, outcome: "success", metadata: { planId: request.body.planId } }); return { subscription }; });
    app.post<{ Params: { subscriptionId: string } }>("/api/v1/commerce/subscriptions/:subscriptionId/renew", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await commerce.renewSubscription(context, request.params.subscriptionId); await writeAudit(database, context, request, { action: "subscription.renewed", targetType: "subscription", targetId: subscription.id, outcome: "success", metadata: { renewalAt: subscription.renewalAt?.toISOString() ?? null } }); return { subscription }; });
    app.get("/api/v1/commerce/financial-summary", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "financials:read"); return { metrics: await commerce.financialSummary(context) }; });
    app.get("/api/v1/commerce/renewal-alerts", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); return { alerts: await commerce.renewalAlerts(context) }; });
    app.get("/api/v1/company-subscriptions", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "financials:read"); return { subscriptions: await companySubscriptions.list(context) }; });
    app.post<{ Body: { provider: string; serviceName: string; category: "saas" | "api" | "infrastructure" | "domain" | "license" | "other"; status: "active" | "trial" | "canceled"; currency: string; amountMinor: number; interval: "monthly" | "quarterly" | "semiannual" | "annual"; renewalAt?: string; renewalAlertDays: number; autoRenew: boolean; websiteUrl?: string; notes?: string } }>("/api/v1/company-subscriptions", { schema: { body: { type: "object", additionalProperties: false, required: ["provider", "serviceName", "category", "status", "currency", "amountMinor", "interval", "renewalAlertDays", "autoRenew"], properties: { provider: { type: "string", minLength: 1, maxLength: 160 }, serviceName: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", enum: ["saas", "api", "infrastructure", "domain", "license", "other"] }, status: { type: "string", enum: ["active", "trial", "canceled"] }, currency: { type: "string", pattern: "^[A-Za-z]{3}$" }, amountMinor: { type: "integer", minimum: 0, maximum: 9007199254740991 }, interval: { type: "string", enum: ["monthly", "quarterly", "semiannual", "annual"] }, renewalAt: { type: "string", format: "date-time" }, renewalAlertDays: { type: "integer", minimum: 0, maximum: 365 }, autoRenew: { type: "boolean" }, websiteUrl: { type: "string", format: "uri", maxLength: 2048 }, notes: { type: "string", maxLength: 4000 } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await companySubscriptions.create(context, { ...request.body, currency: request.body.currency.toUpperCase(), renewalAt: request.body.renewalAt ? new Date(request.body.renewalAt) : null, websiteUrl: request.body.websiteUrl ?? null, notes: request.body.notes ?? null }); await writeAudit(database, context, request, { action: "company_subscription.created", targetType: "company_subscription", targetId: subscription.id, outcome: "success" }); return reply.code(201).send({ subscription }); });
    app.patch<{ Params: { subscriptionId: string }; Body: { status: "active" | "trial" | "canceled" } }>("/api/v1/company-subscriptions/:subscriptionId/status", { schema: { body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["active", "trial", "canceled"] } } } } }, async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "subscriptions:manage"); const subscription = await companySubscriptions.updateStatus(context, request.params.subscriptionId, request.body.status); await writeAudit(database, context, request, { action: "company_subscription.status_changed", targetType: "company_subscription", targetId: subscription.id, outcome: "success", metadata: { status: subscription.status } }); return { subscription }; });
    app.get("/api/v1/invitations", async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "members:manage");
      return { invitations: await listInvitations(database, context) };
    });
    app.post<{ Body: { email: string; role: InvitationRole; locale?: "ca" | "es" | "en" } }>("/api/v1/invitations", { schema: { body: { type: "object", additionalProperties: false, required: ["email", "role"], properties: { email: { type: "string", format: "email", maxLength: 254 }, role: { type: "string", enum: ["administrator", "technical"] }, locale: { type: "string", enum: ["ca", "es", "en"] } } } } }, async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "members:manage");
      if (!options.sendMail || !options.appOrigin) throw new InvitationError("INVITATIONS_NOT_CONFIGURED");
      const invitation = await createInvitation(database, context, { email: request.body.email, role: request.body.role, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
      const locale = request.body.locale ?? "ca";
      const url = new URL(`/${locale}/accept-invitation`, options.appOrigin); url.searchParams.set("token", invitation.token);
      try { await options.sendMail({ to: invitation.email, ...invitationMessage(locale, url.toString()) }); }
      catch (error) { await revokeInvitation(database, context, invitation.id); throw error; }
      await writeAudit(database, context, request, { action: "membership.invited", targetType: "invitation", targetId: invitation.id, outcome: "success", metadata: { email: invitation.email, role: invitation.role } });
      return reply.code(201).send({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } });
    });
    app.delete<{ Params: { invitationId: string } }>("/api/v1/invitations/:invitationId", async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "members:manage");
      await revokeInvitation(database, context, request.params.invitationId);
      await writeAudit(database, context, request, { action: "membership.invitation.revoked", targetType: "invitation", targetId: request.params.invitationId, outcome: "success" });
      return reply.code(204).send();
    });

    const listSchema = { querystring: { type: "object", additionalProperties: false, properties: {
      search: { type: "string", maxLength: 160 }, status: { type: "string", maxLength: 32 }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 }, sort: { type: "string", enum: ["updated_desc", "created_asc", "created_desc", "name_asc", "name_desc", "company_asc", "company_desc", "priority_asc", "priority_desc"], default: "updated_desc" }
    } } } as const;
    type ListQuery = Partial<CrmListQuery>;
    const normalizeListQuery = (query: ListQuery): CrmListQuery => ({ page: query.page ?? 1, pageSize: query.pageSize ?? 25, sort: query.sort ?? "updated_desc", ...(query.search ? { search: query.search } : {}), ...(query.status ? { status: query.status } : {}), ...(query.priority ? { priority: query.priority } : {}) });

    app.get<{ Querystring: ListQuery }>("/api/v1/crm/leads", { schema: listSchema }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:read");
      return crm.listLeads(context, normalizeListQuery(request.query));
    });
    app.post<{ Body: CreateLeadInput }>("/api/v1/crm/leads", { schema: { body: { type: "object", additionalProperties: false, required: ["name", "source", "priority"], properties: {
      name: { type: "string", minLength: 2, maxLength: 160 }, companyName: { type: "string", maxLength: 160 }, email: { type: "string", format: "email", maxLength: 254 }, phone: { type: "string", maxLength: 40 },
      source: { type: "string", minLength: 1, maxLength: 80 }, priority: { type: "string", enum: leadPriorities }, ownerMembershipId: { type: "string", format: "uuid" }
    } } } }, async (request, reply) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:manage");
      const lead = await crm.createLead(context, request.body);
      await writeAudit(database, context, request, { action: "lead.created", targetType: "lead", targetId: lead.id, outcome: "success" });
      return reply.code(201).send({ lead });
    });
    app.patch<{ Params: { leadId: string }; Body: { status: LeadStatus } }>("/api/v1/crm/leads/:leadId/status", { schema: { params: { type: "object", required: ["leadId"], properties: { leadId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: leadStatuses } } } } }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:manage");
      const lead = await crm.transitionLead(context, request.params.leadId, request.body.status);
      await writeAudit(database, context, request, { action: "lead.status.changed", targetType: "lead", targetId: lead.id, outcome: "success", metadata: { status: lead.status } });
      return { lead };
    });
    app.post<{ Params: { leadId: string } }>("/api/v1/crm/leads/:leadId/convert", { schema: { params: { type: "object", required: ["leadId"], properties: { leadId: { type: "string", format: "uuid" } } } } }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:manage");
      const customer = await crm.convertLead(context, request.params.leadId);
      await writeAudit(database, context, request, { action: "lead.converted", targetType: "customer", targetId: customer.id, outcome: "success", metadata: { leadId: request.params.leadId } });
      return { customer };
    });
    app.get<{ Querystring: ListQuery }>("/api/v1/crm/customers", { schema: listSchema }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:read");
      return crm.listCustomers(context, normalizeListQuery(request.query));
    });
    app.get("/api/v1/crm/summary", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:read"); return crm.commercialSummary(context); });
    app.get<{ Params: { customerId: string } }>("/api/v1/crm/customers/:customerId", { schema: { params: { type: "object", required: ["customerId"], properties: { customerId: { type: "string", format: "uuid" } } } } }, async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:read"); return { customer: await crm.getCustomer(context, request.params.customerId) }; });
    app.post<{ Params: { customerId: string }; Body: { name: string; role?: string; email?: string; phone?: string; isPrimary?: boolean } }>("/api/v1/crm/customers/:customerId/contacts", { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 2, maxLength: 160 }, role: { type: "string", maxLength: 120 }, email: { type: "string", format: "email", maxLength: 254 }, phone: { type: "string", maxLength: 40 }, isPrimary: { type: "boolean", default: false } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:manage"); const contact = await crm.addContact(context, request.params.customerId, { ...request.body, isPrimary: request.body.isPrimary ?? false }); await writeAudit(database, context, request, { action: "contact.created", targetType: "contact", targetId: contact.id, outcome: "success" }); return reply.code(201).send({ contact }); });
    app.post<{ Params: { customerId: string }; Body: { body: string } }>("/api/v1/crm/customers/:customerId/notes", { schema: { body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 10000 } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:manage"); const note = await crm.addNote(context, request.params.customerId, request.body.body); await writeAudit(database, context, request, { action: "note.created", targetType: "customer", targetId: request.params.customerId, outcome: "success" }); return reply.code(201).send({ note }); });
    app.post<{ Params: { customerId: string }; Body: { title: string; dueAt?: string; assigneeMembershipId?: string } }>("/api/v1/crm/customers/:customerId/tasks", { schema: { body: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 240 }, dueAt: { type: "string", format: "date-time" }, assigneeMembershipId: { type: "string", format: "uuid" } } } } }, async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:manage"); const task = await crm.addTask(context, request.params.customerId, { title: request.body.title, ...(request.body.dueAt ? { dueAt: new Date(request.body.dueAt) } : {}), ...(request.body.assigneeMembershipId ? { assigneeMembershipId: request.body.assigneeMembershipId } : {}) }); await writeAudit(database, context, request, { action: "task.created", targetType: "task", targetId: task.id, outcome: "success" }); return reply.code(201).send({ task }); });
    app.post<{ Params: { taskId: string } }>("/api/v1/crm/tasks/:taskId/complete", async (request) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "customers:manage"); const task = await crm.completeTask(context, request.params.taskId); await writeAudit(database, context, request, { action: "task.completed", targetType: "task", targetId: task.id, outcome: "success" }); return { task }; });
    app.get("/api/v1/crm/leads/export", async (request, reply) => { const context = await resolveTenantContext(auth, database, request); requirePermission(context, "leads:read"); const page = await crm.listLeads(context, { page: 1, pageSize: 10000, sort: "name_asc" }); const csv = stringifyCsv([["name", "company", "email", "phone", "source", "priority", "status"], ...page.items.map((lead) => [lead.name, lead.companyName, lead.email, lead.phone, lead.source, lead.priority, lead.status])]); return reply.type("text/csv; charset=utf-8").header("content-disposition", "attachment; filename=control-hub-leads.csv").send(csv); });
    app.post<{ Body: { csv: string; commit?: boolean } }>("/api/v1/crm/leads/import", { schema: { body: { type: "object", additionalProperties: false, required: ["csv"], properties: { csv: { type: "string", minLength: 1, maxLength: 5_000_000 }, commit: { type: "boolean", default: false } } } } }, async (request) => {
      const context = await resolveTenantContext(auth, database, request); requirePermission(context, request.body.commit ? "leads:manage" : "leads:read");
      let rows: string[][]; try { rows = parseCsv(request.body.csv); } catch { throw new CrmError("INVALID_INPUT"); } const header = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? []; const required = ["name", "source", "priority"];
      if (!required.every((column) => header.includes(column))) throw new CrmError("INVALID_INPUT");
      const index = (column: string) => header.indexOf(column); const results: { row: number; status: "valid" | "warning" | "imported" | "error"; code?: string }[] = []; const fileEmails = new Set<string>(); const filePhones = new Set<string>(); const fileNames = new Set<string>();
      for (const [offset, row] of rows.entries()) { const input: CreateLeadInput = { name: row[index("name")] ?? "", source: row[index("source")] ?? "manual", priority: (row[index("priority")] || "normal") as LeadPriority, ...(row[index("company")] ? { companyName: row[index("company")] } : {}), ...(row[index("email")] ? { email: row[index("email")] } : {}), ...(row[index("phone")] ? { phone: row[index("phone")] } : {}) };
        try {
          if (!leadPriorities.includes(input.priority) || input.name.trim().length < 2 || input.source.trim().length === 0) throw new CrmError("INVALID_INPUT");
          const emailKey = input.email?.trim().toLowerCase(); const phoneKey = input.phone?.replace(/\D/g, "");
          if (emailKey && fileEmails.has(emailKey)) throw new CrmError("DUPLICATE_EMAIL"); if (phoneKey && filePhones.has(phoneKey)) throw new CrmError("DUPLICATE_PHONE");
          if (emailKey && !/^\S+@\S+\.\S+$/.test(emailKey)) throw new CrmError("INVALID_INPUT");
          const nameKey = normalizeComparableName(input.name); let similarName = fileNames.has(nameKey);
          if (!request.body.commit) { const duplicate = await crm.listLeads(context, { search: emailKey || phoneKey || input.name, page: 1, pageSize: 10, sort: "updated_desc" }); if (duplicate.items.some((lead) => emailKey && lead.email?.trim().toLowerCase() === emailKey)) throw new CrmError("DUPLICATE_EMAIL"); if (duplicate.items.some((lead) => phoneKey && lead.phone?.replace(/\D/g, "") === phoneKey)) throw new CrmError("DUPLICATE_PHONE"); similarName ||= duplicate.items.some((lead) => normalizeComparableName(lead.name) === nameKey); }
          else await crm.createLead(context, input);
          if (emailKey) fileEmails.add(emailKey); if (phoneKey) filePhones.add(phoneKey); fileNames.add(nameKey); results.push({ row: offset + 2, status: request.body.commit ? "imported" : similarName ? "warning" : "valid", ...(similarName && !request.body.commit ? { code: "SIMILAR_NAME" } : {}) });
        } catch (error) { results.push({ row: offset + 2, status: "error", code: error instanceof CrmError ? error.code : "INVALID_INPUT" }); }
      }
      if (request.body.commit) await writeAudit(database, context, request, { action: "lead.imported", targetType: "lead", outcome: "success", metadata: { imported: results.filter((result) => result.status === "imported").length, failed: results.filter((result) => result.status === "error").length } });
      return { results };
    });
  }

  app.get<{ Querystring: { token: string } }>("/api/v1/public/invitations", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { querystring: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 32, maxLength: 128 } } } } }, async (request) => ({ invitation: await lookupInvitation(database, request.query.token) }));
  app.post<{ Body: { token: string; name: string; password: string } }>("/api/v1/public/invitations/accept", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }, schema: { body: { type: "object", additionalProperties: false, required: ["token", "name", "password"], properties: { token: { type: "string", minLength: 32, maxLength: 128 }, name: { type: "string", minLength: 2, maxLength: 120 }, password: { type: "string", minLength: 12, maxLength: 128 } } } } }, async (request, reply) => {
    if (!options.invitationAuth) throw new InvitationError("INVITATIONS_NOT_CONFIGURED");
    const invitation = await lookupInvitation(database, request.body.token);
    const existing = await database<{ id: string }[]>`select id from "user" where email = ${invitation.email}`;
    if (existing[0]) throw new InvitationError("INVITATION_ACCOUNT_EXISTS");
    const registration = await options.invitationAuth.api.signUpEmail({ body: { email: invitation.email, password: request.body.password, name: request.body.name.trim() } });
    if (!registration.user) throw new InvitationError("INVITATION_REGISTRATION_FAILED");
    try { await acceptInvitation(database, request.body.token, registration.user.id, invitation.email); }
    catch (error) { await database`delete from "user" where id = ${registration.user.id}`; throw error; }
    return reply.code(201).send({ status: "accepted", email: invitation.email });
  });

  app.get<{ Reply: LiveHealth }>("/health/live", { schema: { tags: ["health"] } }, async () => ({ status: "ok", service: "api", version: options.version ?? "0.1.0" }));
  app.get<{ Reply: ReadyHealth }>("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const dependencies: ReadyHealth["dependencies"] = {}; let ready = true;
    try { dependencies.postgres = { status: "up", latencyMs: await checkDatabase(database) }; } catch { dependencies.postgres = { status: "down", latencyMs: 0 }; ready = false; }
    try { const startedAt = performance.now(); if (redis.status === "wait") await redis.connect(); await redis.ping(); dependencies.queue = { status: "up", latencyMs: Math.round(performance.now() - startedAt) }; }
    catch { dependencies.queue = { status: "down", latencyMs: 0 }; ready = false; }
    if (!ready) reply.code(503); return { status: ready ? "ready" : "not_ready", service: "api", dependencies };
  });
  app.addHook("onClose", async () => { if (redis.status === "ready") await redis.quit(); else redis.disconnect(); await database.end({ timeout: 5 }); if (options.auth) await options.auth.close(); if (options.invitationAuth) await options.invitationAuth.close(); });
  return app;
}

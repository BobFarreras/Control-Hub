import type {
  AttendanceService,
  CommerceService,
  CompanySubscriptionService,
  ConnectorCredentialService,
  ConnectorIngressService,
  ConnectorService,
  CustomerServicesService,
  CrmService,
  ProjectsService,
  SupportService
} from "@control-hub/application";
import type { DatabaseClient } from "@control-hub/database";
import type { ControlHubAuth } from "../auth.js";
import type { MailSender } from "../email.js";
import type { ControlHubApp } from "../server-instance.js";

/**
 * What every router needs from the composition root.
 *
 * `auth` is non-optional here on purpose: the routes in this directory only exist when
 * authentication is configured, so each router receives an auth instance rather than
 * re-checking for one on every handler.
 */
export type RouteContext = {
  app: ControlHubApp;
  database: DatabaseClient;
  auth: ControlHubAuth;
};

export type CrmContext = RouteContext & { crm: CrmService };
export type CommerceContext = RouteContext & { commerce: CommerceService; customerServices: CustomerServicesService };
export type CompanySubscriptionContext = RouteContext & { companySubscriptions: CompanySubscriptionService };
export type SupportContext = RouteContext & { support: SupportService };
export type ProjectsContext = RouteContext & { projects: ProjectsService };
export type AttendanceContext = RouteContext & { attendance: AttendanceService };
export type InvitationContext = RouteContext & { appOrigin: string | undefined; sendMail: MailSender | undefined };

/**
 * Two services rather than one, and that is the point: `credentials` can seal a secret and has no
 * method that returns one. Reading a credential belongs to the worker, which imports a different
 * class entirely.
 */
export type IntegrationsContext = RouteContext & {
  connectors: ConnectorService;
  /** Null when this installation has no key ring, in which case no credential route is declared. */
  credentials: ConnectorCredentialService | null;
  /** Null for the same reason: minting an endpoint means sealing the secret that signs for it. */
  ingress: ConnectorIngressService | null;
};

/**
 * The inbound webhook route, which has no session and no tenant until the endpoint resolves.
 *
 * It takes the ingress service and nothing else — no database client, no auth. There is no query
 * for it to run of its own, and giving it one would be the first step towards a public route
 * that reads something it was not meant to.
 */
export type WebhookContext = { app: ControlHubApp; ingress: ConnectorIngressService };

/** The public routes run before any session exists, so they take no auth instance. */
export type PublicContext = {
  app: ControlHubApp;
  database: DatabaseClient;
  invitationAuth: ControlHubAuth | undefined;
};

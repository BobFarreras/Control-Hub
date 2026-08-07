import type {
  AttendanceService,
  CommerceService,
  CompanySubscriptionService,
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
export type CommerceContext = RouteContext & { commerce: CommerceService };
export type CompanySubscriptionContext = RouteContext & { companySubscriptions: CompanySubscriptionService };
export type SupportContext = RouteContext & { support: SupportService };
export type ProjectsContext = RouteContext & { projects: ProjectsService };
export type AttendanceContext = RouteContext & { attendance: AttendanceService };
export type InvitationContext = RouteContext & { appOrigin: string | undefined; sendMail: MailSender | undefined };

/** The public routes run before any session exists, so they take no auth instance. */
export type PublicContext = {
  app: ControlHubApp;
  database: DatabaseClient;
  invitationAuth: ControlHubAuth | undefined;
};

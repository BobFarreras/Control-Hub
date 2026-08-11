/**
 * PostgreSQL adapters for the application's repository ports.
 *
 * They live in their own package rather than inside the API because the worker needs them
 * too: the escalation pass reads tickets and writes breach events without an HTTP request in
 * sight. An application cannot import from another application, and duplicating the queries
 * would give the two processes two versions of the same truth.
 */
export * from "./attendance-repository.js";
export * from "./commerce-repository.js";
export * from "./customer-services-repository.js";
export * from "./company-subscription-repository.js";
export * from "./connector-repository.js";
export * from "./credential-vault.js";
export * from "./crm-repository.js";
export * from "./identity-repository.js";
export * from "./ingress-crypto.js";
export * from "./invitation-repository.js";
export * from "./projects-repository.js";
export * from "./support-repository.js";
export * from "./table-preference-repository.js";

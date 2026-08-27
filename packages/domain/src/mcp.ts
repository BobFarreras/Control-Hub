/**
 * Who may call which MCP tool, decided once and without a network.
 *
 * Control Hub is a resource server for MCP: an agent presents a token this installation issued,
 * and every question that follows -- is it ours, is it for this resource, is it still alive, may
 * it reach this tool, may the person behind it reach this tool -- is a rule, not plumbing. The
 * rules live here so the transport cannot answer them differently from the REST API, and so a
 * test can ask them a hundred times without a socket or a database.
 *
 * The authority of a call is an intersection, never a union:
 *
 *   scopes of the token AND permissions of the actor AND published tools AND deployed modules
 *
 * A scope grants nothing the permission does not already grant. Losing the permission stops the
 * calls the same instant, with the token untouched, because the permissions are read again on
 * every request rather than frozen when the token was minted.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

import type { Permission } from "./index.js";

/**
 * Read-only capability groups. They are named after what a person would recognise on a consent
 * screen, not after the permission codes, because the person consenting reads this list.
 *
 * Write scopes are deliberately absent rather than declared and refused: a scope nobody can ask
 * for is one fewer thing to get wrong, and the first delivery publishes no mutating tool.
 */
export const mcpScopes = [
  "mcp:tools.list",
  "crm.read",
  "support.read",
  "projects.read",
  "commerce.read",
  "infrastructure.read",
  "usage.read"
] as const;
export type McpScope = (typeof mcpScopes)[number];

/**
 * The scopes a client may record as its ceiling, which is every one that can be asked for.
 *
 * `mcp:tools.list` is not among them because it is never negotiated: `negotiateMcpScopes` grants it
 * to everyone, so recording it as a ceiling would suggest it could be withheld, and offering it on
 * a registration form would ask somebody to decide something that is not theirs to decide. Both
 * the management screen and dynamic registration read this list rather than keeping a copy, so a
 * scope added above cannot be offered in one place and forgotten in the other.
 */
export const registrableMcpScopes: readonly McpScope[] = mcpScopes.filter((scope) => scope !== "mcp:tools.list");

/**
 * What a scope is worth: the permissions an actor must already hold for it to mean anything.
 *
 * `mcp:tools.list` requires none, because listing what you may call reveals only what you may
 * already do. Every other scope is backed by the same permission the REST route guards, which is
 * what makes the two surfaces answer identically.
 *
 * `commerce.read` maps to `products:manage` because the catalogue has no read-only permission
 * today. That mismatch is exactly why no commerce tool ships in the first delivery: a scope that
 * can only be backed by a manage permission is a scope worth waiting on.
 */
const scopeRequires: Record<McpScope, readonly Permission[]> = {
  "mcp:tools.list": [],
  "crm.read": ["customers:read"],
  "support.read": ["tickets:read"],
  "projects.read": ["projects:read"],
  "commerce.read": ["products:manage"],
  "infrastructure.read": ["infrastructure:read"],
  "usage.read": ["usage:read"]
};

export const mcpGrantStatuses = ["active", "revoked", "expired", "suspended"] as const;
export type McpGrantStatus = (typeof mcpGrantStatuses)[number];

/** Who is acting. A service account has no user behind it, so the two cannot share a shape. */
export const mcpActorTypes = ["user", "service_account"] as const;
export type McpActorType = (typeof mcpActorTypes)[number];
export type McpActor = { readonly type: McpActorType; readonly id: string };

/**
 * The public refusals. They are stable codes: the UI localises them, logs and metrics count them,
 * and none of them says anything about another tenant, another actor or a provider.
 */
export const mcpDenialCodes = [
  "MCP_TOKEN_INVALID",
  "MCP_TOKEN_EXPIRED",
  "MCP_AUDIENCE_INVALID",
  "MCP_TENANT_MISMATCH",
  "MCP_SCOPE_INSUFFICIENT",
  "TOOL_NOT_PUBLISHED",
  "PERMISSION_DENIED"
] as const;
export type McpDenialCode = (typeof mcpDenialCodes)[number];

export type McpVerdict = { readonly allowed: true } | { readonly allowed: false; readonly code: McpDenialCode };

const allowed: McpVerdict = { allowed: true };
const denied = (code: McpDenialCode): McpVerdict => ({ allowed: false, code });

/** What the store knows about a presented token. The token itself never reaches this module. */
export type McpTokenRecord = {
  readonly issuer: string;
  readonly audience: string;
  readonly tenantId: string;
  readonly scopes: readonly McpScope[];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly grantStatus: McpGrantStatus;
};

/** Who we are, from validated installation configuration -- never from a request header. */
export type McpResourceIdentity = { readonly issuer: string; readonly audience: string };

/**
 * Issuer, audience, expiry and revocation, in that order.
 *
 * This installation mints the tokens it validates, so every one of these checks is redundant
 * today. They are written anyway, and the order is part of the contract: audience is settled
 * before tenant, permission or tool are resolved, so a token minted for another resource is
 * refused without ever touching the data it was aimed at. The day a second resource or an
 * external issuer exists, the door is already there.
 */
export function verifyMcpToken(token: McpTokenRecord, resource: McpResourceIdentity, now: Date): McpVerdict {
  if (token.issuer !== resource.issuer) return denied("MCP_TOKEN_INVALID");
  // Exact comparison. Normalising a trailing slash or a case difference into a match is how an
  // audience check quietly stops being one.
  if (token.audience !== resource.audience) return denied("MCP_AUDIENCE_INVALID");
  // Revocation outranks expiry: reporting a revoked token as expired invites a refresh that
  // cannot succeed, and tells the holder the wrong thing about why they were refused.
  if (token.revokedAt !== null) return denied("MCP_TOKEN_INVALID");
  if (token.grantStatus !== "active") return denied("MCP_TOKEN_INVALID");
  if (token.expiresAt.getTime() <= now.getTime()) return denied("MCP_TOKEN_EXPIRED");
  return allowed;
}

/**
 * A tool as authority sees it: a name, the scope that carries it, the permission it needs and
 * whether it changes anything.
 *
 * Deliberately free of schemas, use cases and feature flags. Those belong to the application
 * layer; the domain decides authority from facts the caller supplies.
 */
export type McpToolAuthority = {
  readonly name: string;
  readonly version: `v${number}`;
  readonly scope: McpScope;
  readonly permission: Permission;
  readonly mutating: boolean;
};

export type McpCallAuthority = {
  readonly tool: McpToolAuthority;
  /** Whether this installation deploys the module behind the tool: its feature flag. */
  readonly deployed: boolean;
  readonly token: { readonly tenantId: string; readonly scopes: readonly McpScope[] };
  readonly actor: { readonly permissions: readonly Permission[] };
  /** Any tenant the request tried to name. It is checked, never obeyed. */
  readonly targetTenantId?: string | null;
  /** Off until mutating tools are published and confirmed. */
  readonly writesPublished?: boolean;
};

/**
 * The single decision every tool call passes through.
 *
 * The order is the interesting part:
 *
 * 1. A tenant named in an argument is compared, never trusted. It cannot widen anything.
 * 2. A tool whose module is not deployed, or which mutates while writes are unpublished, does
 *    not exist here. Both answer `TOOL_NOT_PUBLISHED`, and so does an unknown name, so probing
 *    the catalogue tells an attacker nothing.
 * 3. The scope is settled before the permission. The token is the credential presented, so its
 *    authority is decided first, and `MCP_SCOPE_INSUFFICIENT` stays actionable: a client that
 *    lacks a scope can ask for it.
 * 4. The permission answers exactly what REST answers, with the same code. That parity is a
 *    criterion, not a courtesy.
 */
export function authoriseMcpToolCall(input: McpCallAuthority): McpVerdict {
  const { tool, deployed, token, actor, targetTenantId = null, writesPublished = false } = input;
  if (targetTenantId !== null && targetTenantId !== token.tenantId) return denied("MCP_TENANT_MISMATCH");
  if (!deployed) return denied("TOOL_NOT_PUBLISHED");
  if (tool.mutating && !writesPublished) return denied("TOOL_NOT_PUBLISHED");
  if (!token.scopes.includes(tool.scope)) return denied("MCP_SCOPE_INSUFFICIENT");
  if (!actor.permissions.includes(tool.permission)) return denied("PERMISSION_DENIED");
  return allowed;
}

export type McpCatalogueView = {
  readonly catalogue: readonly McpToolAuthority[];
  readonly deployed: (tool: McpToolAuthority) => boolean;
  readonly token: { readonly tenantId: string; readonly scopes: readonly McpScope[] };
  readonly actor: { readonly permissions: readonly Permission[] };
  readonly writesPublished?: boolean;
};

/**
 * What `tools/list` may show: exactly the tools this token can call, and nothing else.
 *
 * It reuses the call decision rather than reimplementing it, so a listing can never disagree
 * with what happens when the tool is invoked -- which is the failure mode that turns a catalogue
 * into a map of everything the caller is not allowed to touch.
 */
export function visibleMcpTools(view: McpCatalogueView): readonly McpToolAuthority[] {
  return view.catalogue.filter(
    (tool) =>
      authoriseMcpToolCall({
        tool,
        deployed: view.deployed(tool),
        token: view.token,
        actor: view.actor,
        writesPublished: view.writesPublished ?? false
      }).allowed
  );
}

/**
 * The scopes a person could consent to, given what they may already do.
 *
 * The consent screen offers these and nothing else, and a service account cannot be created with
 * more than its owner holds. A scope the actor cannot back would be a promise the tool decision
 * refuses to keep a moment later.
 */
export function grantableMcpScopes(permissions: readonly Permission[]): readonly McpScope[] {
  return mcpScopes.filter((scope) => scopeRequires[scope].every((required) => permissions.includes(required)));
}

/** The permissions a scope is worth, for the consent screen and for the audit record. */
export function mcpScopePermissions(scope: McpScope): readonly Permission[] {
  return scopeRequires[scope];
}

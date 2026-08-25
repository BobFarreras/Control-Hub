import {
  authoriseMcpToolCall,
  verifyMcpToken,
  visibleMcpTools,
  type McpResourceIdentity,
  type McpScope,
  type Permission,
  type RoleCode,
  type TenantContext
} from "@control-hub/domain";
import { McpOauthError, type McpCrypto, type McpOauthRepository, type McpTenantScope } from "./mcp-oauth.js";
import {
  mcpToolByName,
  mcpToolAuthorities,
  McpToolInputError,
  type McpJsonSchema,
  type McpToolResult,
  type McpToolServices
} from "./mcp.js";

/**
 * What happens between a bearer token arriving and a use case running.
 *
 * The transport owns none of this on purpose. Deciding who a token belongs to, what it may see and
 * what to write down afterwards are the same decisions whether they arrive over JSON-RPC, over a
 * future transport, or through a test that calls this class directly -- and a rule that lives in a
 * route is a rule that has to be exercised through a socket to be checked at all.
 *
 * Nothing here decides authority itself. The order of the checks, the tenant comparison and the
 * scope-before-permission rule are all in `packages/domain/src/mcp.ts`; this module supplies the
 * facts and carries out what the domain answers.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */

/** Who a token turns out to belong to, resolved fresh from the store at every call. */
export type McpActorIdentity = {
  readonly membershipId: string;
  readonly userId: string;
  readonly roles: readonly RoleCode[];
  /** For a service account, the account's own permissions and not its owner's. */
  readonly permissions: readonly Permission[];
};

export type McpActor = {
  readonly tenantId: string;
  readonly tokenId: string;
  readonly grantId: string;
  readonly scopes: readonly McpScope[];
  readonly actorType: "user" | "service_account";
  /** The membership for a person, the account row for an agent. What the audit record names. */
  readonly actorId: string;
  /**
   * The context the use cases receive.
   *
   * For a service account it names the owner, because the reads need a person and the owner is who
   * answers for the agent. That is not a loss of trail: `actorType` and `actorId` above are what
   * `audit_log` records, so the row says both who is responsible and which agent acted. Publishing
   * mutating tools is the point at which this stops being enough, and `authoriseMcpToolCall`
   * refuses every mutating tool until then.
   */
  readonly context: TenantContext;
};

/** One tool, as an MCP client is shown it. */
export type McpToolListing = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpJsonSchema;
};

export type McpSessionRepository = {
  /**
   * The permissions behind a token, read now rather than carried in it.
   *
   * A token minted an hour ago must not still carry authority somebody took away half an hour
   * later. Null means the membership or the account is gone, which nothing revokes tokens for.
   */
  resolveActor(
    scope: McpTenantScope,
    input: {
      readonly actorType: "user" | "service_account";
      readonly membershipId: string | null;
      readonly serviceAccountId: string | null;
    }
  ): Promise<McpActorIdentity | null>;

  /**
   * One audit row per tool call, whatever the outcome.
   *
   * It records the count and never the payload: a customer list copied into an append-only table
   * is a customer list nobody can delete. And it records the refusals, because what somebody tried
   * is the question an audit trail is actually asked.
   */
  recordToolCall(
    scope: McpTenantScope,
    input: {
      readonly tool: string;
      readonly outcome: "success" | "denied" | "failure";
      readonly code: string | null;
      readonly items: number | null;
      readonly actorType: "user" | "service_account";
      readonly actorId: string;
      readonly userId: string;
      readonly grantId: string;
      readonly at: Date;
    }
  ): Promise<void>;
};

export class McpSessionService {
  private readonly tokens: Pick<McpOauthRepository, "resolveAccessToken" | "touchAccessToken">;
  private readonly sessions: McpSessionRepository;
  private readonly services: McpToolServices;
  private readonly crypto: Pick<McpCrypto, "sha256">;
  private readonly identity: McpResourceIdentity;
  private readonly isDeployed: (flag: "infrastructure" | "usage_costs" | null) => boolean;
  private readonly clock: () => Date;

  constructor(deps: {
    tokens: Pick<McpOauthRepository, "resolveAccessToken" | "touchAccessToken">;
    sessions: McpSessionRepository;
    services: McpToolServices;
    crypto: Pick<McpCrypto, "sha256">;
    identity: McpResourceIdentity;
    /** Whether this installation deploys the module behind a tool. The transport knows; we ask. */
    isDeployed: (flag: "infrastructure" | "usage_costs" | null) => boolean;
    clock?: () => Date;
  }) {
    this.tokens = deps.tokens;
    this.sessions = deps.sessions;
    this.services = deps.services;
    this.crypto = deps.crypto;
    this.identity = deps.identity;
    this.isDeployed = deps.isDeployed;
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Turns a presented token into an actor, or refuses.
   *
   * Absent, unknown and revoked are one answer, deliberately: which of the three it was is exactly
   * what somebody holding a value they found somewhere would like to learn. Expired is the one
   * refusal told apart, because a client can act on it -- it refreshes.
   */
  async authenticate(bearer: string | undefined): Promise<McpActor> {
    if (!bearer) throw new McpOauthError("MCP_TOKEN_INVALID");
    const record = await this.tokens.resolveAccessToken(this.crypto.sha256(bearer));
    if (!record) throw new McpOauthError("MCP_TOKEN_INVALID");

    const now = this.clock();
    const verdict = verifyMcpToken(
      {
        issuer: this.identity.issuer,
        audience: record.audience,
        tenantId: record.tenantId,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
        grantStatus: record.grantStatus
      },
      this.identity,
      now
    );
    if (!verdict.allowed) throw new McpOauthError(verdict.code);

    // Two facts the domain does not hold: a suspended client has to stop every token it issued
    // without deleting a grant, and a consent that reached its expiry is over even though the row
    // still says active. A null client is not a missing one -- it is a grant a service account
    // opened with its secret, where there is no client in the story at all.
    if (record.clientStatus !== null && record.clientStatus !== "active") throw new McpOauthError("MCP_TOKEN_INVALID");
    if (record.grantExpiresAt.getTime() <= now.getTime()) throw new McpOauthError("MCP_TOKEN_INVALID");

    const scope: McpTenantScope = { tenantId: record.tenantId };
    const identity = await this.sessions.resolveActor(scope, {
      actorType: record.actorType,
      membershipId: record.actorMembershipId,
      serviceAccountId: record.actorServiceAccountId
    });
    // Nothing revokes a token at the moment somebody is removed from a tenant, so this is where
    // that has to be noticed rather than half an hour later when the token would have expired.
    if (!identity) throw new McpOauthError("MCP_TOKEN_INVALID");

    // Best effort and after the decision: a failure to write "this was used" must never turn a
    // valid call into a refused one.
    await this.tokens.touchAccessToken(scope, record.tokenId, now);

    return {
      tenantId: record.tenantId,
      tokenId: record.tokenId,
      grantId: record.grantId,
      scopes: record.scopes,
      actorType: record.actorType,
      actorId: record.actorServiceAccountId ?? identity.membershipId,
      context: {
        tenantId: record.tenantId,
        membershipId: identity.membershipId,
        userId: identity.userId,
        roles: [...identity.roles],
        permissions: [...identity.permissions],
        // The consent required a fresh second factor, and this token descends from it. A service
        // account has no session to enrol one on, and its authority is capped at its owner's.
        mfaEnabled: true
      }
    };
  }

  /**
   * The catalogue as this token sees it: exactly the tools it could call, and nothing else.
   *
   * It reuses the call decision rather than filtering by hand, so the listing can never disagree
   * with what happens on invocation -- the failure mode that turns a catalogue into a map of
   * everything the caller is not allowed to touch.
   */
  listTools(actor: McpActor): readonly McpToolListing[] {
    const visible = visibleMcpTools({
      catalogue: mcpToolAuthorities,
      deployed: (authority) => this.isDeployed(mcpToolByName(authority.name)?.flag ?? null),
      token: { tenantId: actor.tenantId, scopes: actor.scopes },
      actor: { permissions: actor.context.permissions }
    });
    return visible.flatMap((authority) => {
      const tool = mcpToolByName(authority.name);
      return tool ? [{ name: authority.name, description: tool.summary, inputSchema: tool.inputSchema }] : [];
    });
  }

  /**
   * One tool call: authorised, run, and written down whatever happened.
   *
   * The audit row is written on every path. An outcome recorded only for what succeeded cannot
   * answer the question an audit trail is actually asked, which is what somebody tried.
   */
  async callTool(actor: McpActor, name: string, input: unknown): Promise<McpToolResult> {
    const at = this.clock();
    const scope: McpTenantScope = { tenantId: actor.tenantId };
    const write = (outcome: "success" | "denied" | "failure", code: string | null, items: number | null) =>
      this.sessions.recordToolCall(scope, {
        tool: name,
        outcome,
        code,
        items,
        actorType: actor.actorType,
        actorId: actor.actorId,
        userId: actor.context.userId,
        grantId: actor.grantId,
        at
      });

    const tool = mcpToolByName(name);
    // An unknown name and a tool this installation does not deploy answer alike, so probing the
    // catalogue tells nobody which tools exist somewhere else.
    if (!tool) {
      await write("denied", "TOOL_NOT_PUBLISHED", null);
      throw new McpOauthError("TOOL_NOT_PUBLISHED");
    }

    const verdict = authoriseMcpToolCall({
      tool: tool.authority,
      deployed: this.isDeployed(tool.flag),
      token: { tenantId: actor.tenantId, scopes: actor.scopes },
      actor: { permissions: actor.context.permissions },
      // Compared, never obeyed: an argument cannot widen what the token already fixed.
      targetTenantId: namedTenant(input)
    });
    if (!verdict.allowed) {
      await write("denied", verdict.code, null);
      throw new McpOauthError(verdict.code);
    }

    try {
      const result = await tool.execute(this.services, actor.context, input);
      await write("success", null, result.items);
      return result;
    } catch (error) {
      // A refused argument is the caller's; anything else is ours. Neither message is recorded --
      // one quotes an input, the other can quote a query, a host or a row.
      const code = error instanceof McpToolInputError ? "TOOL_INPUT_INVALID" : "TOOL_EXECUTION_FAILED";
      await write("failure", code, null);
      throw error;
    }
  }
}

/**
 * A tenant an argument tried to name, if it named one.
 *
 * Read here rather than in each tool because the comparison has to happen for every tool, and one
 * that forgot to pass it would be a tool with no cross-tenant check at all.
 */
function namedTenant(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const named = (input as { tenantId?: unknown }).tenantId;
  return typeof named === "string" ? named : null;
}

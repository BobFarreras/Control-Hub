import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  type ConnectorContext,
  type ConnectorRecord,
  type HttpResponse,
  type OperationResult,
  type RecordValue
} from "../contract.js";

/**
 * Vercel: the projects an account has, and the deployments that failed.
 *
 * Every client site lives here, and the two things that go wrong are the two things nobody is
 * told about: a build that fails on a Friday afternoon, and a production that quietly has nothing
 * valid serving it. Both are facts Vercel already knows and answers in one call.
 *
 * Three decisions shape the code, and the specification argues each one:
 *
 * **A project is a state; a deployment is an event.** The infrastructure model reads states -- a
 * thing is there or it is not, and the latest reading is what counts. A deployment is not that:
 * it happens, it ends, and the next one does not replace it. "The last build failed" is not "this
 * is down", because what is being served is still the one before it, which worked. So two
 * operations with two shapes, and mixing them would lie in one direction or the other.
 *
 * **The base is a literal.** A free-text base would be a way to point the account's API token at
 * a host of the tenant's choosing, and it would be handed over on the first pass. There is
 * nothing legitimate on the other side of that field: Vercel is one provider at one address.
 *
 * **We take a projection, never the payload.** The creator is a person who works for the client
 * and knowing who pushed does nothing to explain the failure; a commit message is free text
 * somebody wrote; build logs are exactly where a project's secrets are printed. The schemas below
 * name what stays and the parser drops the rest before a record is built.
 *
 * Specification: `docs/specifications/connector-vercel.md`.
 */

/**
 * The API these shapes were written against.
 *
 * Vercel versions each endpoint separately and keeps the old ones answering: `/v9/projects` and
 * `/v6/deployments` are both current for reading, and the newer `/v10` and `/v7` differ in fields
 * we do not read. The parsers tolerate drift in the only safe direction -- a missing optional
 * field takes a default, an unexpected field is dropped -- and the contract test is what will say
 * so when a field we do read is renamed.
 */
export const vercelApiVersion = "REST API: projects v9, deployments v6";

const configSchema = z.strictObject({
  /**
   * Fixed, and not a form field anybody fills in. See the module comment: a base a tenant can
   * write is a base that can be pointed at their own host, and the token goes with it.
   */
  baseUrl: z.literal("https://api.vercel.com").default("https://api.vercel.com"),
  /**
   * Absent for a personal account, required for a team token -- and the failure of getting it
   * wrong is silent, which is why health checks it: without the team, the same call answers with
   * the personal projects of whoever minted the token, which are none.
   */
  teamId: z.string().min(1).max(120).optional(),
  /** While somebody is working their previews fail all morning, and none of it is a thing to do. */
  includePreview: z.boolean().default(false),
  /** How far back each pass reads. There is no watermark; see `pullDeployments`. */
  deploymentsWindowHours: z.number().int().min(1).max(168).default(24)
});

export type VercelConfig = z.infer<typeof configSchema>;

/** Kept deliberately small: a page we cannot hold is a worker slot we cannot give back. */
const pageSize = 100;
const maxPagesPerRun = 20;

/**
 * What a `readyState` says about whether production is serving.
 *
 * The three in-flight states are absent on purpose and read as `null`, not `false`: a build under
 * way does not take production down, because what is being served is still the deployment that
 * came before it. Reporting a deploy in progress as an outage would fire an alert every time
 * somebody pushed.
 */
const productionServing: Readonly<Record<string, boolean>> = {
  READY: true,
  ERROR: false,
  CANCELED: false,
  BLOCKED: false,
  DELETED: false
};

const productionTargetSchema = z
  .object({
    readyState: z.string().max(40).optional(),
    createdAt: z.number().int().nonnegative().optional(),
    /** The domains this project serves. Public by definition, and the tenant's own. */
    alias: z.array(z.string().max(300)).max(50).optional()
  })
  .nullish();

const projectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(300).default(""),
  framework: z.string().max(80).nullish(),
  createdAt: z.number().int().nonnegative().optional(),
  targets: z.object({ production: productionTargetSchema }).nullish()
});

/**
 * `pagination.next` is a timestamp, and it comes back as a number on some endpoints and as a
 * string on others. It is only ever put back in a query, so both become the string it will be.
 */
const paginationCursor = z
  .union([z.number(), z.string().max(64)])
  .nullish()
  .transform((value) => (value === null || value === undefined ? null : String(value)));

const projectsPageSchema = z.object({
  projects: z.array(projectSchema).max(pageSize * 2),
  pagination: z.object({ next: paginationCursor }).nullish()
});

const deploymentSchema = z.object({
  uid: z.string().min(1).max(200),
  name: z.string().max(300).default(""),
  projectId: z.string().max(200).nullish(),
  state: z.string().max(40).optional(),
  readyState: z.string().max(40).optional(),
  target: z.string().max(40).nullish(),
  created: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative().optional(),
  /**
   * Whatever the Git provider sent, of which we read the branch and the commit. The object is
   * not strict: the rest of it -- author, e-mail, commit message, pull request title -- is
   * dropped here, which is the point.
   */
  meta: z
    .object({
      githubCommitRef: z.string().max(300).optional(),
      githubCommitSha: z.string().max(120).optional(),
      gitlabCommitRef: z.string().max(300).optional(),
      gitlabCommitSha: z.string().max(120).optional(),
      bitbucketCommitRef: z.string().max(300).optional(),
      bitbucketCommitSha: z.string().max(120).optional()
    })
    .nullish()
});

const deploymentsPageSchema = z.object({
  deployments: z.array(deploymentSchema).max(pageSize * 2),
  pagination: z.object({ next: paginationCursor }).nullish()
});

function parsed<Schema extends z.ZodType>(schema: Schema, response: HttpResponse): z.infer<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new ConnectorError("INVALID_RESPONSE");
  }
  const result = schema.safeParse(body);
  // No issue detail: the value that failed to parse is a provider payload, and it is exactly the
  // kind of thing that carries a customer's data into an error message.
  if (!result.success) throw new ConnectorError("INVALID_RESPONSE");
  return result.data;
}

/**
 * One call, with the token opened for the length of it.
 *
 * The query is built here rather than by the caller so that no operation can put a secret in it:
 * everything that reaches the URL is a literal, a number from configuration, or the team
 * identifier, and the token only ever reaches a header.
 */
async function send(
  context: ConnectorContext<VercelConfig>,
  path: string,
  query: Readonly<Record<string, string>>
): Promise<HttpResponse> {
  const url = new URL(path, context.config.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  if (context.config.teamId) url.searchParams.set("teamId", context.config.teamId);

  const token = await context.secrets.open("api_token");
  return await context.http.send({
    method: "GET",
    url: url.toString(),
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
}

async function get<Schema extends z.ZodType>(
  context: ConnectorContext<VercelConfig>,
  path: string,
  query: Readonly<Record<string, string>>,
  schema: Schema
): Promise<z.infer<Schema>> {
  const response = await send(context, path, query);
  const failure = failureForStatus(response.status);
  // `401` and `403` stay apart all the way up: "the token is not valid" and "the token does not
  // reach this team" are different things to go and fix.
  if (failure) throw new ConnectorError(failure.toUpperCase());
  return parsed(schema, response);
}

/**
 * A provider timestamp as an instant, or null.
 *
 * The range check is not pedantry: `new Date(1e20).toISOString()` throws, and a number far out of
 * range in one field would take down a pass that had already read a hundred good projects.
 */
function isoOrNull(milliseconds: number | undefined): RecordValue {
  if (milliseconds === undefined) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Only the fields we chose. Everything else the provider sent stops here. */
function projectRecord(project: z.infer<typeof projectSchema>): ConnectorRecord {
  const production = project.targets?.production ?? null;
  const state = production?.readyState ?? null;

  return {
    externalId: `project:${project.id}`,
    data: {
      name: project.name,
      framework: project.framework ?? null,
      // Null and not false for a project that never shipped: the alert engine reacts to `false`,
      // and a project nobody has deployed yet is not an outage.
      productionReady: state === null ? null : (productionServing[state] ?? null),
      productionState: state,
      productionDeployedAt: isoOrNull(production?.createdAt),
      productionAlias: production?.alias?.[0] ?? null,
      createdAt: isoOrNull(project.createdAt)
    }
  };
}

function deploymentRecord(deployment: z.infer<typeof deploymentSchema>): ConnectorRecord {
  const meta = deployment.meta ?? {};
  return {
    externalId: `deployment:${deployment.uid}`,
    data: {
      projectId: deployment.projectId ?? null,
      project: deployment.name,
      state: stateOf(deployment),
      target: deployment.target ?? null,
      createdAt: isoOrNull(createdOf(deployment)),
      commitRef: meta.githubCommitRef ?? meta.gitlabCommitRef ?? meta.bitbucketCommitRef ?? null,
      commitSha: meta.githubCommitSha ?? meta.gitlabCommitSha ?? meta.bitbucketCommitSha ?? null
    }
  };
}

/** `state` is what the list endpoint calls it and `readyState` what the deployment object does. */
const stateOf = (deployment: z.infer<typeof deploymentSchema>): string =>
  deployment.state ?? deployment.readyState ?? "unknown";

const createdOf = (deployment: z.infer<typeof deploymentSchema>): number | undefined =>
  deployment.created ?? deployment.createdAt;

/**
 * Every project, every pass.
 *
 * A `state` operation has to be complete or the purge would expire whatever this pass failed to
 * mention. So it pages to the end and returns no cursor: the next pass starts again from the top,
 * which is what makes a project deleted at Vercel eventually disappear from here too.
 */
async function pullProjects(context: ConnectorContext<VercelConfig>): Promise<OperationResult> {
  const records: ConnectorRecord[] = [];
  let until: string | null = null;

  for (let page = 0; page < maxPagesPerRun; page += 1) {
    const query: Record<string, string> = { limit: String(pageSize) };
    if (until) query.until = until;

    const result = await get(context, "/v9/projects", query, projectsPageSchema);
    for (const project of result.projects) records.push(projectRecord(project));

    const next = result.pagination?.next ?? null;
    if (!next) return { records, cursor: null };
    // A cursor that does not move is a page we would ask for forever. It is a broken response,
    // not a long list.
    if (next === until) throw new ConnectorError("INVALID_RESPONSE");
    until = next;
  }

  // More pages than we agreed to read in one pass. Reporting what we have is wrong for a `state`
  // operation -- a partial inventory expires the rest -- so this is a failure, not a truncation.
  throw new ConnectorError("TOO_MANY_PAGES");
}

/**
 * The failed deployments inside the window, read from scratch every pass.
 *
 * There is no watermark here and the difference from `n8n` is deliberate. Vercel orders by when a
 * deployment was **created**, not by when it finished: a build that starts at 10:00 and fails at
 * 10:07 carries 10:00, so a watermark moved past it at 10:05 would never read that failure at
 * all. A watermark is right for an identifier that grows when the fact ends and wrong for one
 * that grows when it begins.
 *
 * Reading the same window again is affordable -- an agency does not fail five hundred builds a
 * day -- and costs nothing: the record carries the same `externalId` and the store upserts it.
 */
async function pullDeployments(context: ConnectorContext<VercelConfig>): Promise<OperationResult> {
  const since = context.clock.now().getTime() - context.config.deploymentsWindowHours * 60 * 60 * 1000;
  const records: ConnectorRecord[] = [];
  let until: string | null = null;

  for (let page = 0; page < maxPagesPerRun; page += 1) {
    const query: Record<string, string> = { limit: String(pageSize), since: String(since), state: "ERROR" };
    if (!context.config.includePreview) query.target = "production";
    if (until) query.until = until;

    const result = await get(context, "/v6/deployments", query, deploymentsPageSchema);

    for (const deployment of result.deployments) {
      // Asked for in the query and checked again here. What must not happen is a preview reaching
      // a record because a filter was ignored, and a test can demand this where it cannot demand
      // what the provider chose to answer.
      if (stateOf(deployment) !== "ERROR") continue;
      if (!context.config.includePreview && deployment.target !== "production") continue;
      records.push(deploymentRecord(deployment));
    }

    const next = result.pagination?.next ?? null;
    if (!next || next === until) return { records, cursor: null };
    until = next;
  }

  // An `event` operation may stop early: what it did not read this time it reads on the next
  // pass, because the window has not moved.
  context.logger.warn({ instanceId: context.instanceId, pages: maxPagesPerRun }, "vercel deployments page limit");
  return { records, cursor: null };
}

export const vercel = defineConnector<VercelConfig>({
  type: "vercel",
  contractVersion: connectorContractVersion,
  configSchema,
  /** The team first, because it is the one that answers with silence when it is wrong. */
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "teamId", kind: "text", group: "connection" },
    { name: "includePreview", kind: "toggle", group: "behaviour" },
    { name: "deploymentsWindowHours", kind: "number", group: "behaviour" }
  ],
  credentialKinds: ["api_token"],
  capabilities: {
    egress: { schemes: ["https"], destination: "configured_base_url" },
    operations: {
      pull_projects: { shape: "state", everySeconds: 5 * 60 },
      pull_deployments: { shape: "event", everySeconds: 5 * 60 }
    },
    ingress: false
  },
  async health(context) {
    // The cheapest authenticated call there is, and it carries the team: it verifies the token
    // and the scope together, which is the pair that has to be right.
    const response = await send(context, "/v9/projects", { limit: "1" });
    const failure = failureForStatus(response.status);
    if (failure) {
      let body: unknown;
      try {
        body = JSON.parse(response.body);
      } catch {
        body = null;
      }
      context.logger.warn(
        {
          instanceId: context.instanceId,
          status: response.status,
          failure,
          teamId: context.config.teamId ?? null,
          responseBody: body
        },
        "vercel health check failed"
      );
      return { status: "failed", failure };
    }
    return { status: "ok" };
  },
  operations: {
    pull_projects: (context) => pullProjects(context),
    pull_deployments: (context) => pullDeployments(context)
  }
});

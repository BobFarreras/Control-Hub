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
 * Supabase: the projects an account has, and whether each one is up.
 *
 * The failure mode this exists for is the small plan's own: a project nobody has touched in a
 * while pauses itself, and everything that depends on it -- a site, an app, an n8n workflow that
 * reads from it -- goes quiet until a client notices first. Supabase already knows the state of
 * every project and answers it in one call.
 *
 * One decision here is not like Vercel's, and the specification argues it in full: **a Supabase
 * management token carries no read-only scope**. The same Personal Access Token that lists
 * projects can pause, delete, or bill them. There is no narrower one to ask for short of standing
 * up OAuth2, which is a different phase and a different connector. This module only ever sends
 * `GET`, and its manifest declares no `actions` -- but the token itself is not the safeguard, the
 * code path is, and that gap is a risk the owner accepted with eyes open, not a thing glossed
 * over. See `docs/specifications/connector-supabase.md`, decision 1.
 *
 * Specification: `docs/specifications/connector-supabase.md`.
 */
export const supabaseApiVersion = "Management API: v1";

const configSchema = z.strictObject({
  /**
   * Fixed, and not a form field anybody fills in. A base a tenant can write is a base that can be
   * pointed at their own host, and the token -- which here carries the whole account -- would go
   * with it on the first pass.
   */
  baseUrl: z.literal("https://api.supabase.com").default("https://api.supabase.com")
});

export type SupabaseConfig = z.infer<typeof configSchema>;

/**
 * `GET /v1/projects` takes no pagination parameters and answers with every project across every
 * organisation the token can see, in one call -- unlike Vercel's `/v9/projects`, there is no
 * cursor to walk. The cap below is a safety valve, not a page size: a response this large is a
 * provider surprise worth failing loudly on, not something to read a slice of.
 */
const maxProjectsPerRun = 2000;

/**
 * What a project's `status` says about whether it is up.
 *
 * The states left out on purpose read as `null`, not `false`: a project mid-restart or
 * mid-upgrade has not gone down, it is doing something, and reporting it as an outage would fire
 * an alert every time somebody upgraded a Postgres version. There is no distinct `PAUSED` value --
 * Supabase reports a project paused for inactivity as `INACTIVE`, the same code a few other kinds
 * of trouble also use, and this connector does not pretend to tell them apart.
 */
const healthyStatus: Readonly<Record<string, boolean>> = {
  ACTIVE_HEALTHY: true,
  INACTIVE: false,
  ACTIVE_UNHEALTHY: false,
  INIT_FAILED: false,
  RESTORE_FAILED: false,
  PAUSE_FAILED: false,
  REMOVED: false
};

const projectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(300).default(""),
  region: z.string().max(80).nullish(),
  status: z.string().max(40).nullish(),
  created_at: z.string().max(60).nullish()
});

const projectsSchema = z.array(projectSchema).max(maxProjectsPerRun);

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
 * The one call, with the token opened for the length of it.
 *
 * `GET /v1/projects` takes no query parameters: everything that reaches the URL is the literal
 * base, and the token only ever reaches a header, never a query string.
 */
async function send(context: ConnectorContext<SupabaseConfig>): Promise<HttpResponse> {
  const url = new URL("/v1/projects", context.config.baseUrl);
  const token = await context.secrets.open("api_token");
  return await context.http.send({
    method: "GET",
    url: url.toString(),
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
}

/** A provider timestamp as an instant, or null. */
function isoOrNull(value: string | null | undefined): RecordValue {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Only the fields we chose. Everything else the provider sent stops here. */
function projectRecord(project: z.infer<typeof projectSchema>): ConnectorRecord {
  const status = project.status ?? null;
  return {
    externalId: `project:${project.id}`,
    data: {
      name: project.name,
      region: project.region ?? null,
      status,
      // Null and not false for a status this table does not name: an unrecognised or transitional
      // status is not a verdict, and the alert engine only reacts to `false`.
      healthy: status === null ? null : (healthyStatus[status] ?? null),
      createdAt: isoOrNull(project.created_at)
    }
  };
}

/**
 * Every project, every pass, in the one call the endpoint offers.
 *
 * There is no cursor to walk and so nothing to truncate on purpose; the cap in `projectsSchema` is
 * the only thing that can turn this into a failure, and only when the account is large enough to
 * make that cap worth raising rather than a page worth reading a slice of. The next pass starts
 * again from the top regardless, which is what makes a project deleted at Supabase eventually
 * disappear from here too.
 */
async function pullProjects(context: ConnectorContext<SupabaseConfig>): Promise<OperationResult> {
  const response = await send(context);
  const failure = failureForStatus(response.status);
  if (failure) throw new ConnectorError(failure.toUpperCase());

  const projects = parsed(projectsSchema, response);
  return { records: projects.map(projectRecord), cursor: null };
}

export const supabase = defineConnector<SupabaseConfig>({
  type: "supabase",
  contractVersion: connectorContractVersion,
  configSchema,
  configFields: [{ name: "baseUrl", kind: "url", group: "connection" }],
  credentialKinds: ["api_token"],
  capabilities: {
    egress: { schemes: ["https"], destination: "configured_base_url" },
    operations: {
      pull_supabase_projects: { shape: "state", everySeconds: 5 * 60 }
    },
    ingress: false
  },
  async health(context) {
    const response = await send(context);
    const failure = failureForStatus(response.status);
    return failure ? { status: "failed", failure } : { status: "ok" };
  },
  operations: {
    pull_supabase_projects: (context) => pullProjects(context)
  }
});

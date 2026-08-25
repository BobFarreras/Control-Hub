import type { ConnectorFailureKind, Permission } from "@control-hub/domain";
import type { ZodType } from "zod";

/**
 * The connector contract.
 *
 * The shape of everything here follows one decision, and it is worth stating plainly because
 * the rest only makes sense in its light: **a connector never receives a database handle**. It
 * is given ports, it returns normalised data, and the application layer — which is already
 * inside a tenant scope — decides what to persist. That is what turns "a defective connector
 * cannot cross a tenant boundary" from a rule somebody has to remember into a thing that cannot
 * be expressed: there is nothing here to cross it with.
 *
 * Specification: `docs/specifications/connectors.md`.
 */

/** Bumped only for a breaking change; a connector declares the version it implements. */
export const connectorContractVersion = 1;

export class ConnectorError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Shortens the runtime's budget for this call. It can never lengthen it. */
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
};

/**
 * The only way out of the process.
 *
 * Implemented by the worker's guarded fetch, which resolves DNS, refuses private and reserved
 * addresses, connects to the address it validated and revalidates every redirect. A connector
 * cannot reach the network any other way, because nothing else is handed to it — that is the
 * property, not the guard itself.
 */
export type HttpPort = {
  send(request: HttpRequest): Promise<HttpResponse>;
};

/**
 * Opens a sealed credential just in time.
 *
 * The value belongs to the call that asked for it. Storing it on an object, putting it in a
 * returned record or passing it to a logger are all ways of turning a just-in-time secret back
 * into a persistent one.
 */
export type SecretsPort = {
  open(kind: string): Promise<string>;
};

export type LoggerPort = {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
};

export type ClockPort = { now(): Date };

export type MailFolder = {
  id: string;
  name: string;
};

export type MailCursor = {
  folderId: string;
  /** Opaque and monotonic within the selected folder. */
  cursor: string | null;
  limit: number;
};

export type MailMessageRef = {
  folderId: string;
  messageId: string;
};

export type MailReadLimits = {
  maxHeaderBytes: number;
  maxBodyBytes: number;
};

export type MailChange = {
  messageId: string;
  receivedAt: Date;
};

export type MailChangePage = {
  changes: readonly MailChange[];
  cursor: string;
};

export type MailAddress = {
  address: string;
  name: string | null;
};

export type MailMessage = {
  id: string;
  threadId: string | null;
  messageIdHeader: string | null;
  subject: string | null;
  from: MailAddress | null;
  to: readonly MailAddress[];
  receivedAt: Date;
  text: string | null;
};

/**
 * High-level mailbox access owned by the worker adapter.
 *
 * Deliberately absent are sockets, arbitrary destinations and raw MIME streams. The adapter owns
 * DNS, TLS, authentication, byte limits and timeouts; a connector only asks mailbox questions.
 */
export type MailboxPort = {
  listFolders(): Promise<readonly MailFolder[]>;
  changes(input: MailCursor): Promise<MailChangePage>;
  message(input: MailMessageRef, limits: MailReadLimits): Promise<MailMessage>;
};

/**
 * What a handler is given. Note what is absent: no database, no global `fetch`, no `process.env`
 * and no tenant identifier — a connector has nothing to do per tenant, and handing it one would
 * only suggest otherwise.
 */
export type ConnectorContext<Config> = {
  /** Opaque, and useful for building an idempotency key the provider will accept. */
  instanceId: string;
  config: Config;
  http: HttpPort;
  secrets: SecretsPort;
  logger: LoggerPort;
  clock: ClockPort;
  /** Present only for a connector whose manifest declares a mailbox policy. */
  mailbox?: MailboxPort;
};

/** Where a connector is allowed to connect. Never an address somebody typed into a form. */
export type EgressPolicy = {
  schemes: readonly string[];
  /**
   * `configured_base_url` restricts calls to the instance's own configuration.
   * `operator_allowlist` restricts them to destinations the installation declared, which is how
   * an internal service on the same host is reached without a tenant being able to name it.
   */
  destination: "configured_base_url" | "operator_allowlist";
};

export type MailboxPolicy = {
  ports: readonly (993 | 143)[];
  tls: "direct" | "starttls";
};

export type OAuthDeclaration = {
  provider: "google" | "microsoft";
  authorizationUrl: string;
  tokenUrl: string;
  revocationUrl: string;
  scopes: readonly string[];
};

export type ActionDeclaration = {
  permission: Permission;
  confirmation: "explicit";
  requiresMfa: boolean;
  reversible: boolean;
  retry: "before-delivery-only" | "idempotent-provider";
};

/**
 * The shape of what an operation returns, which is what decides how long it is kept.
 *
 * `state` is one row per thing observed, overwritten by the next pass: a host's memory, a
 * workflow's enabled flag. It expires from disuse — a thing the provider stopped naming.
 * `event` is one row per fact that never comes back: an execution that failed at 03:12. It
 * expires by age.
 *
 * The connector declares it because the connector is the only place that knows. A purge left to
 * guess would either drop an execution history somebody needs or keep every metric sample ever
 * read, and the second one is only noticed when the table is too large to fix quietly.
 */
export type RecordShape = "state" | "event";

/**
 * The floor the platform puts under a declared cadence.
 *
 * A connector that could ask to be polled every second would be helping itself to a share of
 * every other tenant's worker time, and that is not a decision that belongs inside a connector.
 * Refused at module load rather than clamped: a manifest that asks for five seconds and silently
 * gets sixty is a manifest that lies to whoever reads it next.
 */
export const minimumCadenceSeconds = 60;

export type OperationDeclaration = {
  shape: RecordShape;
  /**
   * How often the platform polls this operation.
   *
   * Absent means nothing schedules it: it runs when something asks for it and not otherwise. The
   * number lives in the manifest and not in a tenant's configuration because the cost of a poll
   * is paid by the installation, not by the tenant who would be choosing it.
   */
  everySeconds?: number;
};

/**
 * What the runtime will let this connector do. Not documentation: an operation missing from
 * `operations` cannot be dispatched even when the code for it exists.
 */
export type CapabilityManifest = {
  egress: EgressPolicy | null;
  operations: Readonly<Record<string, OperationDeclaration>>;
  actions?: Readonly<Record<string, ActionDeclaration>>;
  ingress: boolean;
  /** Absence means this connector must never receive mailbox access. */
  mailbox?: MailboxPolicy;
  /** Fixed provider metadata used by the platform OAuth flow; never tenant configuration. */
  oauth?: OAuthDeclaration;
};

/**
 * `unverifiable` is not a failure and not a pass: it is a connector with nothing it can call.
 *
 * An inbound-only integration is the ordinary case — plenty of providers post to us and offer no
 * endpoint to ask. Reporting that as healthy would manufacture evidence, which is exactly what
 * `connectorHealth` in the domain refuses to do; the runtime records it as no evidence at all.
 */
export type HealthReport =
  { status: "ok" } | { status: "failed"; failure: ConnectorFailureKind } | { status: "unverifiable" };

/**
 * What a record may carry: JSON, and nothing else.
 *
 * It used to be `unknown`, which was honest while records were counted and thrown away. Now they
 * are stored as `jsonb`, so a connector returning a `Date`, a `Map` or a class instance is a bug
 * that has to fail at the connector rather than at the insert, where the message would name a
 * column instead of the handler that built the value.
 */
export type RecordValue = null | string | number | boolean | RecordValue[] | { [key: string]: RecordValue };

/** One thing fetched from a provider, keyed by the identifier that makes a retry idempotent. */
export type ConnectorRecord = {
  externalId: string;
  data: Readonly<Record<string, RecordValue>>;
};

export type OperationInput = { cursor: string | null };

export type OperationResult = {
  records: readonly ConnectorRecord[];
  /** Opaque continuation token. The runtime stores it and hands it back unread. */
  cursor: string | null;
};

export type ActionInput = Readonly<Record<string, RecordValue>>;
export type ActionResult = { externalId: string | null };
export type ConnectorAction<Config> = (context: ConnectorContext<Config>, input: ActionInput) => Promise<ActionResult>;

export type ConnectorOperation<Config> = (
  context: ConnectorContext<Config>,
  input: OperationInput
) => Promise<OperationResult>;

/**
 * How a provider signs what it sends.
 *
 * The connector declares the shape; the verification itself stays in the API, which owns the
 * raw body and the endpoint's secret. Keeping the comparison out of connector code means one
 * implementation to review rather than one per provider.
 */
export type IngressSignature = {
  algorithm: "hmac-sha256";
  signatureHeader: string;
  timestampHeader: string;
  /** Builds the exact bytes the provider signed. */
  payload(timestamp: string, rawBody: string): string;
};

export type IngressRequest = {
  /** Exactly as received. The signature was already verified against these bytes. */
  body: string;
  headers: Readonly<Record<string, string>>;
  receivedAt: Date;
};

export type IngressResult = {
  /** The provider's own event id, or null when it sends none and the runtime must hash the body. */
  eventId: string | null;
  /** False when the instance filtered this event out. It is recorded as discarded, not dropped. */
  accepted: boolean;
  /** Metadata worth keeping beside the event. Never the whole payload. */
  summary: Readonly<Record<string, string>>;
  /** Sanitized records a worker may project after the signed delivery has been queued. */
  records?: readonly ConnectorRecord[];
};

/** May be synchronous: reading an event a provider already sent needs no I/O of its own. */
export type IngressHandler<Config> = (
  context: ConnectorContext<Config>,
  request: IngressRequest
) => IngressResult | Promise<IngressResult>;

/**
 * How a configuration field is drawn.
 *
 * Presentation is a choice, so a connector declares it; a `text` and a `url` are both strings to
 * the schema, and only the connector knows which one an operator is being asked for. What is
 * *required* is not a choice but a fact about the schema, so it is read from there instead —
 * see `configFieldsOf`. The split is the point: two declarations of the same truth drift, and the
 * one that drifts is always the one a form was drawn from.
 */
export type ConfigFieldKind = "url" | "text" | "number" | "toggle" | "list";

/**
 * What the field is for, which decides where a form puts it.
 *
 * `connection` is what it takes to reach the provider at all: get one wrong and nothing works.
 * `behaviour` is how much to read once reached, and every such field answers for itself, so a
 * form can fold them away and still be complete. The schema cannot tell the two apart — both are
 * ordinary keys to it — so the connector says which is which, and the schema is then asked
 * whether it meant it.
 */
export type ConfigFieldGroup = "connection" | "behaviour";

/** What a connector declares: a name, how to draw it, and what it is for. */
export type ConfigFieldDeclaration = { name: string; kind: ConfigFieldKind; group: ConfigFieldGroup };

/** A default a form can put in an input. Anything richer is not something a person types. */
export type ConfigFieldDefault = string | number | boolean | readonly string[];

/** What the platform hands to a screen, with the schema's own answers filled in. */
export type ConfigField = ConfigFieldDeclaration & {
  required: boolean;
  /** The schema's own default, or `null` when it has none: not every optional field has one. */
  defaultValue: ConfigFieldDefault | null;
};

export type ConnectorDefinition<Config> = {
  type: string;
  contractVersion: typeof connectorContractVersion;
  /** Allowlisted fields. Unknown keys are rejected, never stripped and silently ignored. */
  configSchema: ZodType<Config>;
  /** Every key of `configSchema`, in the order a form should ask for them. */
  configFields: readonly ConfigFieldDeclaration[];
  credentialKinds: readonly string[];
  capabilities: CapabilityManifest;
  health(context: ConnectorContext<Config>): Promise<HealthReport>;
  operations: Readonly<Record<string, ConnectorOperation<Config>>>;
  actions?: Readonly<Record<string, { schema: ZodType<ActionInput>; handle: ConnectorAction<Config> }>>;
  ingress?: { signature: IngressSignature; handle: IngressHandler<Config> };
};

export type ConfigIssue = { path: string; code: string };

export type ConfigResult = { ok: true; config: unknown } | { ok: false; issues: readonly ConfigIssue[] };

/**
 * A connector as the rest of the system sees it, with its configuration type erased.
 *
 * The erasure is deliberate and is where revalidation happens: a handler is never reached
 * without its configuration having been parsed first, so a schema that changed in a release
 * cannot meet an instance still holding the previous shape.
 */
export type RegisteredConnector = {
  type: string;
  contractVersion: number;
  configFields: readonly ConfigField[];
  credentialKinds: readonly string[];
  capabilities: CapabilityManifest;
  ingressSignature: IngressSignature | null;
  parseConfig(value: unknown): ConfigResult;
  health(context: ConnectorContext<unknown>): Promise<HealthReport>;
  run(operation: string, context: ConnectorContext<unknown>, input: OperationInput): Promise<OperationResult>;
  act(action: string, context: ConnectorContext<unknown>, input: unknown): Promise<ActionResult>;
  ingest(context: ConnectorContext<unknown>, request: IngressRequest): Promise<IngressResult>;
};

/**
 * Turns validation failures into a path and a code, and nothing else.
 *
 * Zod's own message quotes what it received, and what it received is a configuration payload
 * that may carry a token somebody pasted into the wrong field. An error travels to an API
 * response, a log and a screen; the value must not travel with it.
 */
function issuesOf(error: { issues: readonly { path: PropertyKey[]; code: string }[] }): ConfigIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: issue.code }));
}

/**
 * The per-key schemas of an object schema, or null for a schema whose keys cannot be enumerated.
 *
 * Read through the public `shape` rather than through zod's internals, so that a zod release that
 * rearranges its private fields does not quietly turn every field list into an empty one.
 */
function objectShape(schema: ZodType<unknown>): Record<string, ZodType<unknown>> | null {
  const shape: unknown = (schema as { shape?: unknown }).shape;
  return shape !== null && typeof shape === "object" ? (shape as Record<string, ZodType<unknown>>) : null;
}

/**
 * Fills in what each declared field is, and refuses a declaration that has drifted from the
 * schema in either direction.
 *
 * A field naming a key the schema does not have would draw an input whose value is thrown away
 * on save. A schema key with no field is worse and is the defect this exists to prevent: a
 * setting that cannot be reached from a screen at all, discovered by an operator who has to be
 * told to use `curl` instead. Both are refused at module load, where the stack names the
 * connector, rather than on the day somebody opens the form.
 *
 * Necessity and the default are one question asked once: what does this key do with nothing? It
 * refuses, so somebody has to fill it in; it answers with a value, which is the default a form
 * should already be showing; or it answers with nothing, so the field is optional and starts
 * empty. Asking once means the two answers cannot contradict each other, and a connector that
 * changes a default changes what the form offers without anybody editing a form.
 */
function defaultOf(key: ZodType<unknown>): ConfigFieldDefault | null {
  const result = key.safeParse(undefined);
  if (!result.success) return null;

  const value: unknown = result.data;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  // Anything else is not a default an input can hold, and a form is better off empty than showing
  // `[object Object]` and inviting somebody to edit it.
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return null;
}

function configFieldsOf(
  schema: ZodType<unknown>,
  declarations: readonly ConfigFieldDeclaration[]
): readonly ConfigField[] {
  const shape = objectShape(schema);
  if (!shape) {
    if (declarations.length > 0) throw new ConnectorError("CONFIG_FIELDS_UNDERIVABLE");
    return [];
  }

  const fields = declarations.map((declaration) => {
    const key = shape[declaration.name];
    if (!key) throw new ConnectorError("CONFIG_FIELD_UNKNOWN");
    const required = !key.safeParse(undefined).success;
    // Folding a field away is only honest if the schema can proceed without it. A required field
    // declared as behaviour would be hidden behind a disclosure and then refused on submit, with
    // the complaint pointing at something the operator was never shown.
    if (declaration.group === "behaviour" && required) throw new ConnectorError("CONFIG_FIELD_NOT_OPTIONAL");
    return { ...declaration, required, defaultValue: defaultOf(key) };
  });

  const declared = new Set(fields.map((field) => field.name));
  for (const name of Object.keys(shape)) if (!declared.has(name)) throw new ConnectorError("CONFIG_FIELD_MISSING");
  return fields;
}

/**
 * Registers a connector, checking the invariants a manifest can drift away from.
 *
 * A handler the manifest does not list would be reachable code nobody declared; a name the
 * manifest lists without a handler is a promise the runtime cannot keep. Both are caught here,
 * at module load, rather than on the day somebody triggers that operation.
 */
export function defineConnector<Config>(definition: ConnectorDefinition<Config>): RegisteredConnector {
  const declared = new Set(Object.keys(definition.capabilities.operations));
  const implemented = new Set(Object.keys(definition.operations));
  for (const name of declared) if (!implemented.has(name)) throw new ConnectorError("OPERATION_NOT_IMPLEMENTED");
  for (const name of implemented) if (!declared.has(name)) throw new ConnectorError("OPERATION_NOT_DECLARED");
  const declaredActions = new Set(Object.keys(definition.capabilities.actions ?? {}));
  const implementedActions = new Set(Object.keys(definition.actions ?? {}));
  for (const name of declaredActions)
    if (!implementedActions.has(name)) throw new ConnectorError("ACTION_NOT_IMPLEMENTED");
  for (const name of implementedActions)
    if (!declaredActions.has(name)) throw new ConnectorError("ACTION_NOT_DECLARED");
  for (const declaration of Object.values(definition.capabilities.operations)) {
    const every = declaration.everySeconds;
    if (every === undefined) continue;
    if (!Number.isSafeInteger(every)) throw new ConnectorError("CADENCE_NOT_A_WHOLE_SECOND");
    if (every < minimumCadenceSeconds) throw new ConnectorError("CADENCE_TOO_FREQUENT");
  }
  if (definition.capabilities.ingress !== Boolean(definition.ingress)) throw new ConnectorError("INGRESS_MISDECLARED");
  if (definition.contractVersion !== connectorContractVersion) throw new ConnectorError("UNSUPPORTED_CONTRACT_VERSION");
  const configFields = configFieldsOf(definition.configSchema, definition.configFields);

  const parseConfig = (value: unknown): ConfigResult => {
    const result = definition.configSchema.safeParse(value);
    return result.success ? { ok: true, config: result.data } : { ok: false, issues: issuesOf(result.error) };
  };

  const typedContext = (context: ConnectorContext<unknown>): ConnectorContext<Config> => {
    const result = definition.configSchema.safeParse(context.config);
    if (!result.success) throw new ConnectorError("INVALID_CONFIG");
    const typed: ConnectorContext<Config> = {
      instanceId: context.instanceId,
      config: result.data,
      http: context.http,
      secrets: context.secrets,
      logger: context.logger,
      clock: context.clock
    };
    if (definition.capabilities.mailbox) {
      if (!context.mailbox) throw new ConnectorError("MAILBOX_PORT_REQUIRED");
      typed.mailbox = context.mailbox;
    }
    return typed;
  };

  return {
    type: definition.type,
    contractVersion: definition.contractVersion,
    configFields,
    credentialKinds: definition.credentialKinds,
    capabilities: definition.capabilities,
    ingressSignature: definition.ingress?.signature ?? null,
    parseConfig,
    // Async so that a configuration rejected here rejects the promise. Throwing synchronously
    // from a function that returns one puts the error where no `await` will catch it.
    health: async (context) => await definition.health(typedContext(context)),
    run: async (operation, context, input) => {
      const handler = declared.has(operation) ? definition.operations[operation] : undefined;
      if (!handler) throw new ConnectorError("UNKNOWN_OPERATION");
      return await handler(typedContext(context), input);
    },
    act: async (action, context, input) => {
      const implementation = declaredActions.has(action) ? definition.actions?.[action] : undefined;
      if (!implementation) throw new ConnectorError("UNKNOWN_ACTION");
      const parsed = implementation.schema.safeParse(input);
      if (!parsed.success) throw new ConnectorError("INVALID_ACTION_INPUT");
      return await implementation.handle(typedContext(context), parsed.data);
    },
    ingest: async (context, request) => {
      const ingress = definition.ingress;
      if (!ingress) throw new ConnectorError("INGRESS_NOT_SUPPORTED");
      return await ingress.handle(typedContext(context), request);
    }
  };
}

/**
 * The failure a response status means, or null when the call succeeded.
 *
 * Shared rather than repeated per connector: whether a `429` is worth retrying is a property of
 * HTTP and of our retry policy, not of any one provider, and two connectors disagreeing about it
 * would make the same outage behave differently depending on which one hit it.
 */
export function failureForStatus(status: number): ConnectorFailureKind | null {
  if (status >= 200 && status < 400) return null;
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_response";
}

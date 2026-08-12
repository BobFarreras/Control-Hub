import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { isAllowlistedDestination, type AllowedDestination } from "@control-hub/config";
import type { EgressPolicy, HttpPort, HttpRequest, HttpResponse } from "@control-hub/connectors";
import { isAllowedEgressAddress, isOriginBoundHeader, type ConnectorFailureKind } from "@control-hub/domain";

/**
 * The only way out of the process.
 *
 * Every call and every redirect goes through the same six questions, in the same order, and the
 * connector never gets to ask them itself: it is handed this object and nothing else that can
 * reach a socket. The property the specification asks for is not that the guard is careful — it
 * is that there is no second path.
 *
 * The anti-rebinding measure is the `lookup` we install on the request. We resolve the name,
 * decide about the address we got, and then hand the http client a resolver that returns that
 * exact address and nothing else. The hostname still travels in `Host` and in the TLS SNI, so the
 * far end sees an ordinary request, but a name that changes its answer between our check and our
 * connection changes nothing: we never ask twice.
 *
 * Specification: `docs/specifications/connector-security.md`.
 */

export class EgressError extends Error {
  constructor(
    public readonly code: string,
    public readonly failure: ConnectorFailureKind
  ) {
    super(code);
  }
}

export type EgressBudgets = {
  connectMs: number;
  headersMs: number;
  totalMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
};

/**
 * The defaults of the specification. A connector may ask for less on one call and never for more:
 * `send` takes the smaller of the two, so a budget cannot be widened from inside a connector.
 */
export const defaultBudgets: EgressBudgets = {
  connectMs: 5_000,
  headersMs: 5_000,
  totalMs: 30_000,
  maxResponseBytes: 5 * 1024 * 1024,
  maxRedirects: 3
};

/** Resolution, injectable so the SSRF suite is a unit test and CI does not depend on a resolver. */
export type AddressResolver = (hostname: string) => Promise<{ address: string; family: number }>;

export const systemResolver: AddressResolver = async (hostname) => {
  const resolved = await dnsLookup(hostname, { verbatim: true });
  return { address: resolved.address, family: resolved.family };
};

export type GuardedHttpOptions = {
  policy: EgressPolicy;
  /** The instance's own base URL, when the policy confines it there. */
  baseUrl: string | null;
  allowlist: readonly AllowedDestination[];
  budgets?: Partial<EgressBudgets>;
  resolve?: AddressResolver;
  /** Identifies us to the provider. Never carries a tenant, a customer or an instance. */
  userAgent?: string;
};

const defaultUserAgent = "ControlHub-Connector/1.0";

export function createGuardedHttp(options: GuardedHttpOptions): HttpPort {
  const budgets = { ...defaultBudgets, ...options.budgets };
  const resolve = options.resolve ?? systemResolver;
  const base = options.baseUrl ? safeParseUrl(options.baseUrl) : null;

  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const deadline = Date.now() + Math.min(budgets.totalMs, request.timeoutMs ?? budgets.totalMs);
      let target = check(request.url, options, base);
      let headers = { ...request.headers };
      let body = request.body;

      for (let redirects = 0; ; redirects += 1) {
        const validated = await validateAddress(target, options, resolve);
        const response = await send(target, validated, {
          method: request.method,
          headers: { "user-agent": options.userAgent ?? defaultUserAgent, ...headers },
          ...(body === undefined ? {} : { body }),
          deadline,
          budgets
        });

        const location = redirectTarget(response);
        if (!location) return response;
        if (redirects >= budgets.maxRedirects) throw new EgressError("TOO_MANY_REDIRECTS", "invalid_response");

        const next = check(new URL(location, target).toString(), options, base);
        // A redirect that leaves the origin must not carry the credential meant for the first one.
        if (next.origin !== target.origin) headers = withoutOriginBoundHeaders(headers);
        // 303, and 301/302 on a write, continue as a GET without a body: that is what every client
        // does, and carrying the body on to a destination we did not authenticate would be worse.
        if (response.status === 303 || (response.status < 303 && request.method !== "GET")) {
          body = undefined;
          headers = withoutHeaders(headers, ["content-type", "content-length"]);
        }
        target = next;
      }
    }
  };
}

function safeParseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new EgressError("URL_NOT_PARSEABLE", "invalid_config");
  }
}

/**
 * Everything that can be decided from the URL alone, before a name is ever resolved.
 *
 * Destination first, scheme second, credentials third — the order matters only in that all three
 * happen, but doing the cheap refusals here keeps a hostile URL from reaching the resolver at all.
 */
function check(raw: string, options: GuardedHttpOptions, base: URL | null): URL {
  const url = safeParseUrl(raw);

  if (!options.policy.schemes.includes(url.protocol.replace(":", ""))) {
    throw new EgressError("SCHEME_NOT_ALLOWED", "blocked_destination");
  }
  // `https://user:pass@host` is how a URL smuggles a host past a reader who stops at the first
  // `@`, and it is never how a provider is addressed.
  if (url.username || url.password) throw new EgressError("URL_HAS_CREDENTIALS", "blocked_destination");

  if (options.policy.destination === "operator_allowlist") {
    if (!isAllowlistedDestination(options.allowlist, url)) {
      throw new EgressError("DESTINATION_NOT_ALLOWLISTED", "blocked_destination");
    }
    return url;
  }

  if (!base) throw new EgressError("NO_BASE_URL_CONFIGURED", "invalid_config");
  if (!isUnderBase(url, base)) throw new EgressError("DESTINATION_OUTSIDE_BASE_URL", "blocked_destination");
  return url;
}

/**
 * Whether a URL is genuinely inside the configured base.
 *
 * Compared on origin and on path segments, not with `startsWith`: a base of `https://p.test/v1`
 * would otherwise admit `https://p.test/v1-internal`, which is a different resource on the same
 * host and not one the instance was configured for.
 */
function isUnderBase(url: URL, base: URL): boolean {
  if (url.origin !== base.origin) return false;
  const segments = (value: string) => value.split("/").filter((segment) => segment.length > 0);
  const baseSegments = segments(base.pathname);
  const urlSegments = segments(url.pathname);
  return baseSegments.every((segment, index) => urlSegments[index] === segment);
}

async function validateAddress(
  url: URL,
  options: GuardedHttpOptions,
  resolve: AddressResolver
): Promise<{ address: string; family: number }> {
  const hostname = url.hostname.replace(/^\[|]$/g, "");

  let resolved: { address: string; family: number };
  try {
    resolved = await resolve(hostname);
  } catch {
    throw new EgressError("DNS_RESOLUTION_FAILED", "connection_reset");
  }

  if (isAllowedEgressAddress(resolved.address)) return resolved;
  // An operator naming an origin is naming a machine they run. That is the only thing that can
  // override the address rules, and it is checked against the URL rather than the address so a
  // public name cannot be rebound onto an allowlisted host's address.
  if (isAllowlistedDestination(options.allowlist, url)) return resolved;
  throw new EgressError("ADDRESS_NOT_ROUTABLE", "blocked_destination");
}

function withoutOriginBoundHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !isOriginBoundHeader(name)));
}

function withoutHeaders(headers: Record<string, string>, names: readonly string[]): Record<string, string> {
  const unwanted = new Set(names);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !unwanted.has(name.toLowerCase())));
}

function redirectTarget(response: HttpResponse): string | null {
  if (response.status < 300 || response.status > 399) return null;
  return response.headers["location"] ?? null;
}

type SendOptions = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  deadline: number;
  budgets: EgressBudgets;
};

/**
 * One hop, with three separate clocks.
 *
 * Connect, first byte of the response and the whole exchange are budgeted apart because they fail
 * apart: a destination that accepts the connection and then says nothing forever is the case a
 * single overall timeout handles far too late, and it is exactly what an attacker sets up to tie
 * up a worker.
 */
function send(
  url: URL,
  validated: { address: string; family: number },
  options: SendOptions
): Promise<HttpResponse> {
  const remaining = options.deadline - Date.now();
  if (remaining <= 0) throw new EgressError("BUDGET_EXHAUSTED", "timeout");

  return new Promise<HttpResponse>((resolve, reject) => {
    let settled = false;
    let headersTimer: NodeJS.Timeout | undefined;
    const totalTimer = setTimeout(() => finish(new EgressError("TOTAL_TIMEOUT", "timeout")), remaining);

    const finish = (error: EgressError | null, response?: HttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(headersTimer);
      request.destroy();
      if (error) reject(error);
      else resolve(response!);
    };

    const requestOptions: HttpsRequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method,
      headers: { ...options.headers, host: url.host },
      // TLS is verified against the name, not against the address we pinned. Turning this off
      // would trade an SSRF defence for a man in the middle, which is not a trade.
      servername: url.protocol === "https:" ? url.hostname : undefined,
      // No pooling. A kept-alive socket is a socket opened for an address validated earlier, and
      // reusing it would quietly undo the pin below.
      agent: false,
      // This is the pin. Node hands it to `net.connect`, so the socket goes to the address we
      // already decided about, whatever the name resolves to by now.
      lookup: pinnedLookup(validated)
    };

    const request = url.protocol === "https:" ? httpsRequest(requestOptions) : httpRequest(requestOptions);

    headersTimer = setTimeout(() => finish(new EgressError("CONNECT_TIMEOUT", "timeout")), options.budgets.connectMs);

    request.on("socket", (socket) => {
      socket.on("connect", () => {
        clearTimeout(headersTimer);
        headersTimer = setTimeout(
          () => finish(new EgressError("HEADERS_TIMEOUT", "timeout")),
          options.budgets.headersMs
        );
      });
    });

    request.on("error", () => finish(new EgressError("CONNECTION_FAILED", "connection_reset")));

    request.on("response", (message: IncomingMessage) => {
      clearTimeout(headersTimer);
      const chunks: Buffer[] = [];
      let received = 0;

      message.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > options.budgets.maxResponseBytes) {
          finish(new EgressError("RESPONSE_TOO_LARGE", "response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      message.on("error", () => finish(new EgressError("RESPONSE_FAILED", "connection_reset")));
      message.on("end", () =>
        finish(null, {
          status: message.statusCode ?? 0,
          headers: singleValueHeaders(message.headers),
          body: Buffer.concat(chunks).toString("utf8")
        })
      );
    });

    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * A resolver that has already made up its mind.
 *
 * Node calls it with `{ all: true }` in some paths and without in others, and the callback shape
 * differs between the two. Both are answered with the one address we validated.
 */
function pinnedLookup(validated: { address: string; family: number }): LookupFunction {
  return (_hostname: string, lookupOptions: unknown, callback: unknown) => {
    const all = typeof lookupOptions === "object" && lookupOptions !== null && "all" in lookupOptions;
    if (all && (lookupOptions as { all?: boolean }).all === true) {
      (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [validated]);
      return;
    }
    (callback as (error: null, address: string, family: number) => void)(null, validated.address, validated.family);
  };
}

/**
 * Repeated headers are joined rather than dropped, and `set-cookie` is dropped rather than joined.
 *
 * A connector has no use for a cookie — it holds no session — and a value that arrives as an array
 * in one response and a string in another is a shape bug waiting for the first provider that sends
 * two.
 */
function singleValueHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === "set-cookie") continue;
    result[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

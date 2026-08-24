import type { IngressOutcome } from "@control-hub/application";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { problemContentType, problemDetails } from "../problem.js";
import type { WebhookContext } from "./context.js";

/**
 * The one public route of the connector platform.
 *
 * Everything here exists to make three different failures answer identically. An unknown
 * `publicId`, a signature that does not match and a timestamp outside the window all leave
 * through `refuse`, which builds one document from one code — so somebody walking the address
 * space learns nothing, and a future change cannot break that by mapping a new case to a new
 * status without touching this function.
 *
 * Specification: `docs/specifications/connectors.md`, "Webhooks entrants".
 */

/** The specification's limit. A provider that needs more than this is sending us a file. */
const bodyLimit = 1024 * 1024;

/**
 * The allowlist, enforced by being the only parser this scope has.
 *
 * `removeAllContentTypeParsers` drops the JSON parser the rest of the API uses, so a delivery
 * with any other content type is refused by Fastify before a handler sees it — and the one
 * parser left keeps the bytes as a string, because a body re-serialised from a parsed object is
 * no longer the body that was signed.
 */
const acceptedContentType = "application/json";

/**
 * Per endpoint, not per address: a provider posts from a pool of addresses that changes without
 * telling us, and one busy integration must not spend another's budget. The identifier is
 * truncated because it becomes a key in Valkey and an unbounded one is a memory budget somebody
 * else chooses.
 */
function webhookRateLimitKey(request: FastifyRequest): string {
  const publicId = (request.params as { publicId?: string }).publicId ?? "";
  return `webhook:${publicId.slice(0, 64)}`;
}

/**
 * What each outcome is answered with, as a table rather than as branches in a handler.
 *
 * Every refusal maps to the same status and the same code here, in one line, which is the whole
 * of "unknown endpoint, invalid signature and out-of-window timestamp answer identically". A new
 * refusal reason inherits it by construction; giving one its own answer would take an edit to
 * this function, which is where somebody would notice.
 */
export function ingressAnswer(outcome: IngressOutcome): { status: number; code: string | null } {
  if (outcome.status === "accepted") return { status: 202, code: null };
  // The exception, and the only one: reaching it requires our signing secret. See IngressOutcome.
  if (outcome.status === "unreadable") return { status: 400, code: outcome.code };
  return { status: 404, code: "NOT_FOUND" };
}

/** What the framework refuses on its own, said in this API's vocabulary rather than Fastify's. */
const frameworkCodes: Record<number, string> = {
  400: "INVALID_INPUT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED"
};

/** Flattened, lowercase, and only what arrived once. A repeated header is not a signature. */
function singleValueHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

export function registerWebhookRoutes({ app, ingress, queue }: WebhookContext) {
  /**
   * The answer, written once.
   *
   * The instance and the request identifier differ per request and not per cause, which is what a
   * support ticket needs and what an attacker cannot correlate anything with.
   */
  function answer(request: FastifyRequest, reply: FastifyReply, outcome: IngressOutcome) {
    const { status, code } = ingressAnswer(outcome);
    if (!code) return reply.code(status).send();
    return reply
      .code(status)
      .type(problemContentType)
      .send(
        problemDetails({
          status,
          code,
          instance: request.url.split("?")[0] ?? request.url,
          requestId: request.id
        })
      );
  }

  void app.register((scope, _options, done) => {
    /**
     * The framework's own refusals, answered with the status the framework chose.
     *
     * The API's error handler turns anything it does not recognise into `500`, which is right for
     * a fault of ours and wrong for a body over the limit or a content type we do not accept: a
     * provider reading `500` retries the same oversized delivery for as long as its queue allows.
     * Scoped to this plugin, so the rest of the API keeps the envelope it has.
     */
    scope.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
      const status = statusCode >= 400 && statusCode < 500 ? statusCode : 500;
      if (status >= 500) request.log.error({ err: error }, "webhook delivery failed");
      return reply
        .code(status)
        .type(problemContentType)
        .send(
          problemDetails({
            // Never the framework's own code: `FST_ERR_CTP_INVALID_MEDIA_TYPE` would become part
            // of this API's contract by being sent once.
            code: frameworkCodes[status] ?? "INTERNAL_ERROR",
            status,
            instance: request.url.split("?")[0] ?? request.url,
            requestId: request.id
          })
        );
    });

    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(acceptedContentType, { parseAs: "string", bodyLimit }, (_request, body, done) => {
      done(null, body);
    });

    scope.post<{ Params: { publicId: string }; Body: string }>(
      "/api/v1/webhooks/:publicId",
      {
        bodyLimit,
        config: { rateLimit: { max: 240, timeWindow: "1 minute", keyGenerator: webhookRateLimitKey } },
        // No params schema on purpose: a malformed identifier would be answered `400` by the
        // validator and a well-formed unknown one `404`, which is the enumeration this route is
        // written to prevent. The service refuses both the same way.
        //
        // Described in the document even so. Hiding it would only keep it out of the page an
        // integrator reads, and this is the one address a provider is configured against: the
        // uniform refusal is a property of the handler, not of an undocumented route.
        schema: {
          tags: ["webhooks"],
          summary: "Receive a delivery from a provider",
          description:
            "Public: authenticated by the endpoint's own signature, not by a session. The delivery must be `application/json`, at most 1 MiB, and signed with the secret handed over when the address was minted; the body is verified as the bytes that arrived, so a re-serialised payload will not match. 202 with an empty body means stored, not processed, and a redelivery answers the same. Every refusal — unknown address, bad signature, timestamp outside the window — answers 404 `NOT_FOUND`."
        }
      },
      async (request, reply) => {
        const outcome: IngressOutcome = await ingress.accept({
          publicId: request.params.publicId,
          rawBody: typeof request.body === "string" ? request.body : "",
          headers: singleValueHeaders(request),
          receivedAt: new Date()
        });

        if (outcome.status === "accepted" && outcome.stored === "pending") {
          await queue.enqueue({ tenantId: outcome.tenantId, eventId: outcome.eventId });
        }

        // The reason stays with us, and only in a log. `debug` and not `warn`: a probe is
        // ordinary traffic on a public address, and a line per attempt at `warn` is how an alert
        // becomes noise. A payload we could not read is different — that provider holds our
        // signing secret, so somebody should hear about it.
        if (outcome.status === "refused") request.log.debug({ reason: outcome.reason }, "webhook delivery refused");
        if (outcome.status === "unreadable") request.log.warn({ code: outcome.code }, "webhook payload unreadable");

        // 202 with an empty body when it is accepted: the event is stored, and nothing about it
        // has been processed yet. A duplicate answers the same, which is what makes a provider's
        // redelivery safe.
        return answer(request, reply, outcome);
      }
    );

    done();
  });
}

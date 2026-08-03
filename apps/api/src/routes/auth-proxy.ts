import { isSensitiveAuthRequest, rateLimitKey } from "../rate-limit.js";
import { requestHeaders } from "../request-headers.js";
import type { RouteContext } from "./context.js";

/** Forwards the better-auth handler. Credential paths get a strict budget; session
 *  bookkeeping does not, because it runs once per rendered page. */
export function registerAuthProxyRoutes({ app, auth, appOrigin }: RouteContext & { appOrigin: string | undefined }) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: {
      rateLimit: {
        max: (request) => (isSensitiveAuthRequest(request) ? 10 : 240),
        timeWindow: "1 minute",
        ban: 20,
        keyGenerator: rateLimitKey
      }
    },
    handler: async (request, reply) => {
      const url = new URL(request.url, appOrigin ?? "http://localhost:3001");
      const init: RequestInit = { method: request.method, headers: requestHeaders(request.headers) };
      if (request.method !== "GET" && request.body !== undefined) init.body = JSON.stringify(request.body);
      const response = await auth.handler(new Request(url, init));
      reply.code(response.status);
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    }
  });
}

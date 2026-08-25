import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rule under test is one sentence: only an answer the API actually gave may send somebody to
 * the login form. It is worth a test of its own because getting it wrong is invisible in review
 * and expensive in use — every restart of the API threw the user out, and the session in
 * PostgreSQL was valid the whole time.
 */
const redirect = vi.fn((path: string) => {
  // The real one signals by throwing, and the code under test relies on that.
  throw new Error(`REDIRECT:${path}`);
});
const apiFetch = vi.fn<(path: string) => Promise<Response>>();
const hasSessionCookie = vi.fn<() => Promise<boolean>>();

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("./api", () => ({
  apiFetch: (path: string) => apiFetch(path),
  hasSessionCookie: () => hasSessionCookie()
}));

const { requireSession, ApiUnreachableError } = await import("./require-session");

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response;

describe("requireSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSessionCookie.mockResolvedValue(true);
  });

  it("passes when the API confirms a session", async () => {
    apiFetch.mockResolvedValue(json(200, { user: { id: "u1" } }));
    await expect(requireSession("ca")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends somebody to the login form when the API says there is no session", async () => {
    apiFetch.mockResolvedValue(json(200, null));
    await expect(requireSession("ca")).rejects.toThrow("REDIRECT:/ca/login");
    expect(redirect).toHaveBeenCalledWith("/ca/login");
  });

  it("sends somebody to the login form on a rejected session", async () => {
    apiFetch.mockResolvedValue(json(401, { code: "AUTHENTICATION_REQUIRED" }));
    await expect(requireSession("ca")).rejects.toThrow("REDIRECT:/ca/login");
  });

  it("does not touch the session when the API cannot be reached", async () => {
    apiFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(requireSession("ca")).rejects.toThrow(ApiUnreachableError);
    // The whole point: a refused connection is not somebody being signed out.
    expect(redirect).not.toHaveBeenCalled();
  });

  it("treats a 5xx as the API not having answered, not as a rejection", async () => {
    apiFetch.mockResolvedValue(json(503, { code: "SERVICE_UNAVAILABLE" }));
    await expect(requireSession("ca")).rejects.toThrow(ApiUnreachableError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("treats an unreadable body the same way", async () => {
    const truncated: Pick<Response, "ok" | "status" | "json"> = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Unexpected end of JSON input"))
    };
    apiFetch.mockResolvedValue(truncated as Response);
    await expect(requireSession("ca")).rejects.toThrow(ApiUnreachableError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still goes to the login form when there is no cookie at all", async () => {
    hasSessionCookie.mockResolvedValue(false);
    await expect(requireSession("ca")).rejects.toThrow("REDIRECT:/ca/login");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  /**
   * The consent screen is opened from a link an agent composed, so somebody arriving signed out is
   * answering a request rather than browsing. Landing them on the dashboard after they authenticate
   * loses the request -- and carrying the destination in the address is also how open redirects are
   * built, which is why it is validated rather than trusted.
   */
  it("carries a return path so a sign-in does not lose the request", async () => {
    hasSessionCookie.mockResolvedValue(false);
    await expect(requireSession("es", "/es/mcp/consent?client_id=abc&state=1")).rejects.toThrow("REDIRECT:");
    expect(redirect).toHaveBeenCalledWith(
      `/es/login?next=${encodeURIComponent("/es/mcp/consent?client_id=abc&state=1")}`
    );
  });

  it("drops a return path that could leave the panel, rather than repairing it", async () => {
    hasSessionCookie.mockResolvedValue(false);
    for (const destination of ["https://attacker.test/collect", "//attacker.test", "/\\attacker.test"]) {
      vi.clearAllMocks();
      hasSessionCookie.mockResolvedValue(false);
      await expect(requireSession("ca", destination)).rejects.toThrow("REDIRECT:/ca/login");
      expect(redirect, destination).toHaveBeenCalledWith("/ca/login");
    }
  });

  it("carries the return path through a session the API rejects, not only a missing cookie", async () => {
    // The two paths out of this function reach the login form separately, and an increment that
    // fixed one and forgot the other would look right until somebody's cookie went stale.
    apiFetch.mockResolvedValue(json(200, null));
    await expect(requireSession("ca", "/ca/mcp/consent?client_id=abc")).rejects.toThrow("REDIRECT:");
    expect(redirect).toHaveBeenCalledWith(`/ca/login?next=${encodeURIComponent("/ca/mcp/consent?client_id=abc")}`);
  });
});

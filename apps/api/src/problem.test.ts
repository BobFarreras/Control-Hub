import {
  ConnectorCredentialError,
  ConnectorServiceError,
  ConnectorStorageError,
  InfrastructureServiceError
} from "@control-hub/application";
import { describe, expect, it } from "vitest";
import { describeConnectorError, problemDetails, usesProblemDetails } from "./problem.js";
import { ApiSecurityError } from "./security.js";

describe("which routes answer in problem details", () => {
  it("covers the connector and infrastructure surfaces, and leaves the rest of the API alone", () => {
    expect(usesProblemDetails("/api/v1/integrations")).toBe(true);
    expect(usesProblemDetails("/api/v1/integrations/abc/runs?page=2")).toBe(true);
    expect(usesProblemDetails("/api/v1/connectors")).toBe(true);
    expect(usesProblemDetails("/api/v1/infrastructure/alerts")).toBe(true);
    expect(usesProblemDetails("/api/v1/crm/leads")).toBe(false);
    expect(usesProblemDetails("/health/ready")).toBe(false);
  });
});

describe("the status a connector failure deserves", () => {
  const codeAndStatus = (error: unknown) => {
    const described = describeConnectorError(error);
    return described && [described.code, described.status];
  };

  /** Acceptance criterion 2: a configuration the rules refuse is 422, with a stable code. */
  it("answers 422 for a rule the request broke rather than a field it malformed", () => {
    expect(codeAndStatus(new ConnectorServiceError("INVALID_CONFIG"))).toEqual(["INVALID_CONFIG", 422]);
    expect(codeAndStatus(new ConnectorServiceError("UNKNOWN_CONNECTOR_TYPE"))).toEqual(["UNKNOWN_CONNECTOR_TYPE", 422]);
    expect(codeAndStatus(new ConnectorServiceError("INVALID_NAME"))).toEqual(["INVALID_NAME", 422]);
  });

  /** Acceptance criterion 7: an administrator is refused, and told so as 403 and not as 404. */
  it("answers 403 for a permission and 404 for an instance that is not this tenant's", () => {
    expect(codeAndStatus(new ConnectorServiceError("FORBIDDEN"))).toEqual(["FORBIDDEN", 403]);
    expect(codeAndStatus(new ConnectorServiceError("INSTANCE_NOT_FOUND"))).toEqual(["INSTANCE_NOT_FOUND", 404]);
    expect(codeAndStatus(new ApiSecurityError(403, "PERMISSION_DENIED"))).toEqual(["PERMISSION_DENIED", 403]);
    expect(codeAndStatus(new ApiSecurityError(401, "AUTHENTICATION_REQUIRED"))).toEqual([
      "AUTHENTICATION_REQUIRED",
      401
    ]);
  });

  it("answers 409 when two people acted at once, not 400", () => {
    expect(codeAndStatus(new ConnectorServiceError("INSTANCE_NOT_ENABLED"))).toEqual(["INSTANCE_NOT_ENABLED", 409]);
    expect(codeAndStatus(new ConnectorCredentialError("ROTATION_ALREADY_OPEN"))).toEqual([
      "ROTATION_ALREADY_OPEN",
      409
    ]);
    expect(codeAndStatus(new ConnectorStorageError("DUPLICATE_INSTANCE_NAME"))).toEqual([
      "DUPLICATE_INSTANCE_NAME",
      409
    ]);
  });

  it("treats a missing second factor as a refusal, which is what it is", () => {
    expect(codeAndStatus(new ConnectorCredentialError("MFA_REQUIRED"))).toEqual(["MFA_REQUIRED", 403]);
  });

  it("turns a schema failure into a code, never into the framework's message", () => {
    const validation = Object.assign(new Error("body/secret must be string"), { validation: [] });
    expect(codeAndStatus(validation)).toEqual(["INVALID_INPUT", 400]);
  });

  /**
   * An error nobody classified is a bug of ours. Saying nothing about it is deliberate: the
   * caller gets a 500 and the details stay in our log.
   */
  it("does not classify an error it does not know", () => {
    expect(describeConnectorError(new TypeError("cannot read properties of undefined"))).toBeNull();
  });

  it("carries the issues of an invalid configuration, and nothing else", () => {
    const described = describeConnectorError(
      new ConnectorServiceError("INVALID_CONFIG", [{ path: "baseUrl", code: "invalid_string" }])
    );
    expect(described?.params).toEqual({ issues: [{ path: "baseUrl", code: "invalid_string" }] });
  });
});

describe("the document itself", () => {
  it("is RFC 9457, with a type derived from the code", () => {
    expect(
      problemDetails({ status: 422, code: "INVALID_CONFIG", instance: "/api/v1/integrations", requestId: "req-1" })
    ).toEqual({
      type: "https://control-hub.example/problems/invalid-config",
      title: "Invalid configuration",
      status: 422,
      code: "INVALID_CONFIG",
      instance: "/api/v1/integrations",
      requestId: "req-1"
    });
  });

  it("falls back to a title rather than shipping an undefined one", () => {
    const document = problemDetails({ status: 500, code: "SOMETHING_NEW", instance: "/x", requestId: "req-1" });
    expect(document.title).toBe("Unexpected error");
    expect(document.type).toBe("https://control-hub.example/problems/something-new");
  });
});

describe("the status an infrastructure failure deserves", () => {
  const codeAndStatus = (error: unknown) => {
    const described = describeConnectorError(error);
    return described && [described.code, described.status];
  };

  /** Acceptance criterion 9: an Administrator reads and is refused everything that changes. */
  it("answers 403 for a permission, and 404 for a row that is not this tenant's", () => {
    expect(codeAndStatus(new InfrastructureServiceError("FORBIDDEN"))).toEqual(["FORBIDDEN", 403]);
    expect(codeAndStatus(new InfrastructureServiceError("RULE_NOT_FOUND"))).toEqual(["RULE_NOT_FOUND", 404]);
    expect(codeAndStatus(new InfrastructureServiceError("ALERT_NOT_FOUND"))).toEqual(["ALERT_NOT_FOUND", 404]);
  });

  it("answers 409 when two people acted at once, and 422 for a rule the request broke", () => {
    expect(codeAndStatus(new InfrastructureServiceError("DUPLICATE_RULE_NAME"))).toEqual(["DUPLICATE_RULE_NAME", 409]);
    expect(codeAndStatus(new InfrastructureServiceError("ALERT_ALREADY_HAS_INCIDENT"))).toEqual([
      "ALERT_ALREADY_HAS_INCIDENT",
      409
    ]);
    expect(codeAndStatus(new InfrastructureServiceError("INVALID_FRESHNESS"))).toEqual(["INVALID_FRESHNESS", 422]);
    expect(codeAndStatus(new InfrastructureServiceError("TARGET_REQUIRED"))).toEqual(["TARGET_REQUIRED", 422]);
  });

  /**
   * The inventory of increment B2 rides the same mapping, which is the point of the mapping: a
   * code added later gets its status from the class it belongs to rather than a new branch.
   */
  it("places the inventory's own refusals in the same classes", () => {
    expect(codeAndStatus(new InfrastructureServiceError("HOST_NOT_FOUND"))).toEqual(["HOST_NOT_FOUND", 404]);
    expect(codeAndStatus(new InfrastructureServiceError("SERVICE_NOT_FOUND"))).toEqual(["SERVICE_NOT_FOUND", 404]);
    expect(codeAndStatus(new InfrastructureServiceError("DUPLICATE_HOSTNAME"))).toEqual(["DUPLICATE_HOSTNAME", 409]);
    expect(codeAndStatus(new InfrastructureServiceError("DUPLICATE_MATCH_KEY"))).toEqual(["DUPLICATE_MATCH_KEY", 409]);
    expect(codeAndStatus(new InfrastructureServiceError("INVALID_HOSTNAME"))).toEqual(["INVALID_HOSTNAME", 422]);
    expect(codeAndStatus(new InfrastructureServiceError("INVALID_MATCH_KEY"))).toEqual(["INVALID_MATCH_KEY", 422]);
  });

  /**
   * A body naming a client that is not there is 422 and not 404: the route exists and the request
   * is well formed, and answering 404 would say the alert rule surface itself is missing.
   */
  it("keeps a missing reference in the body at 422, where a caller can act on it", () => {
    expect(codeAndStatus(new InfrastructureServiceError("REFERENCE_NOT_FOUND"))).toEqual(["REFERENCE_NOT_FOUND", 422]);
  });

  /** A code with no title of its own still gets a readable one rather than leaking the enum. */
  it("gives every infrastructure code a title a person can read", () => {
    const problem = problemDetails({
      status: 422,
      code: "INVALID_FRESHNESS",
      instance: "/api/v1/infrastructure/alert-rules",
      requestId: "req-1"
    });
    expect(problem.title).not.toBe("Unexpected error");
    expect(problem.type).toBe("https://control-hub.example/problems/invalid-freshness");
  });
});

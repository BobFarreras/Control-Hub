import { describe, expect, it } from "vitest";
import {
  connectorDiagnosisSteps,
  diagnoseConnector,
  type ConnectorDiagnosisFacts,
  type ConnectorDiagnosisStep,
  type DiagnosisStatus
} from "./connector-diagnosis.js";

/** Everything true. Each test spoils exactly the one fact it is about. */
const healthy: ConnectorDiagnosisFacts = {
  missingMigrations: [],
  originAllowlisted: true,
  lastAttempt: { ok: true, code: null },
  seenInstances: ["node-exporter:9100"],
  declaredHostnames: ["node-exporter:9100"]
};

const facts = (overrides: Partial<ConnectorDiagnosisFacts> = {}): ConnectorDiagnosisFacts => ({
  ...healthy,
  ...overrides
});

const statuses = (input: ConnectorDiagnosisFacts): Record<string, DiagnosisStatus> =>
  Object.fromEntries(diagnoseConnector(input).findings.map((finding) => [finding.step, finding.status]));

const findingFor = (input: ConnectorDiagnosisFacts, step: ConnectorDiagnosisStep) => {
  const finding = diagnoseConnector(input).findings.find((candidate) => candidate.step === step);
  if (!finding) throw new Error(`no finding for ${step}`);
  return finding;
};

describe("the shape of an answer", () => {
  it("reports every step, always in the order the chain is built", () => {
    expect(diagnoseConnector(facts()).findings.map((finding) => finding.step)).toEqual([...connectorDiagnosisSteps]);
  });

  it("names no problem when the whole chain holds", () => {
    const diagnosis = diagnoseConnector(facts());
    expect(diagnosis.problem).toBeNull();
    expect(diagnosis.findings.every((finding) => finding.status === "passed")).toBe(true);
  });

  /**
   * The point of the ordering. Each rung only means something if the one below it is true, so
   * judging the rest would be inventing answers -- "no readings" is not evidence that a machine
   * is gone when the reason is that no pass has ever got out of the process.
   */
  it("stops at the first thing that fails and leaves the rest unchecked", () => {
    const diagnosis = diagnoseConnector(facts({ missingMigrations: ["0037_infrastructure_hosts.sql"] }));

    expect(diagnosis.problem).toBe("migrations");
    expect(diagnosis.findings.map((finding) => finding.status)).toEqual([
      "failed",
      "unchecked",
      "unchecked",
      "unchecked",
      "unchecked",
      "unchecked"
    ]);
  });
});

describe("the migrations the module needs", () => {
  /** Acceptance criterion 1: the afternoon this whole phase exists to give back. */
  it("says which files are missing, so the screen can name them", () => {
    const missing = ["0037_infrastructure_hosts.sql", "0039_infrastructure_alert_kinds.sql"];
    expect(findingFor(facts({ missingMigrations: missing }), "migrations")).toEqual({
      step: "migrations",
      status: "failed",
      code: null,
      evidence: { migrations: missing }
    });
  });

  it("answers in a stable order whatever order it was told about them", () => {
    const jumbled = ["0039_infrastructure_alert_kinds.sql", "0037_infrastructure_hosts.sql"];
    expect(findingFor(facts({ missingMigrations: jumbled }), "migrations").evidence.migrations).toEqual([
      "0037_infrastructure_hosts.sql",
      "0039_infrastructure_alert_kinds.sql"
    ]);
  });
});

describe("whether the guard lets the call out at all", () => {
  /** Acceptance criterion 2, at the layer that decides it. */
  it("fails when the origin is not on the deployment allowlist", () => {
    expect(statuses(facts({ originAllowlisted: false }))).toMatchObject({
      migrations: "passed",
      allowlist: "failed",
      reachable: "unchecked"
    });
  });

  /**
   * The API and the worker are separate processes reading their own copy of the environment. When
   * ours says the origin is allowed and the run that actually went out says it was refused, the
   * one that tried is right, and what it found is a deployment where the two disagree.
   */
  it("believes the run over our own copy of the list", () => {
    const refused = facts({ originAllowlisted: true, lastAttempt: { ok: false, code: "DESTINATION_NOT_ALLOWLISTED" } });
    expect(findingFor(refused, "allowlist")).toMatchObject({ status: "failed", code: "DESTINATION_NOT_ALLOWLISTED" });
  });

  /** Everything the guard refuses before anything leaves the process answers at this rung. */
  it.each(["SCHEME_NOT_ALLOWED", "URL_HAS_CREDENTIALS", "NO_BASE_URL_CONFIGURED", "DESTINATION_OUTSIDE_BASE_URL"])(
    "answers %s here, where the guard raised it",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        allowlist: "failed",
        reachable: "unchecked"
      });
    }
  );
});

describe("whether anything answers at the far end", () => {
  /** Acceptance criterion 3: the tunnel is shut, and that is a different fact from a wrong port. */
  it.each(["CONNECT_TIMEOUT", "CONNECTION_FAILED", "CONNECTION_RESET", "TIMEOUT", "DNS_RESOLUTION_FAILED"])(
    "reads %s as nothing answering",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        allowlist: "passed",
        reachable: "failed",
        answers_prometheus: "unchecked"
      });
    }
  );

  /**
   * Absence of a check is not evidence of a closed tunnel. Nobody has looked, and saying the
   * machine is unreachable because we never asked is the same lie `unknown` exists to prevent
   * everywhere else on this screen.
   */
  it("says it does not know when no check has ever run", () => {
    const diagnosis = diagnoseConnector(facts({ lastAttempt: null }));
    expect(diagnosis.problem).toBe("reachable");
    expect(statuses(facts({ lastAttempt: null }))).toMatchObject({
      allowlist: "passed",
      reachable: "unknown",
      answers_prometheus: "unchecked"
    });
  });

  it("still refuses the origin without a check, because that answer needs no far end", () => {
    expect(statuses(facts({ lastAttempt: null, originAllowlisted: false }))).toMatchObject({ allowlist: "failed" });
  });

  it("does not know where a failure without a code belongs", () => {
    expect(statuses(facts({ lastAttempt: { ok: false, code: null } }))).toMatchObject({ reachable: "unknown" });
  });
});

describe("whether what answers is a Prometheus", () => {
  it.each(["INVALID_RESPONSE", "NOT_FOUND", "UNAUTHORIZED", "SERVER_ERROR", "RESPONSE_TOO_LARGE"])(
    "reads %s as something else on that port",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        reachable: "passed",
        answers_prometheus: "failed",
        scraping: "unchecked"
      });
    }
  );

  /**
   * A code this release has never heard of still has to land somewhere. Here is the safe rung:
   * everything below it is evidence we have, and the sentence is about the far end rather than
   * about the network, which is what a code from a newer connector most likely means.
   */
  it("puts a code it does not recognise here rather than nowhere", () => {
    expect(statuses(facts({ lastAttempt: { ok: false, code: "SOMETHING_NEWER" } }))).toMatchObject({
      answers_prometheus: "failed"
    });
  });

  it("carries the code so the screen can say which of them it was", () => {
    expect(findingFor(facts({ lastAttempt: { ok: false, code: "UNAUTHORIZED" } }), "answers_prometheus").code).toBe(
      "UNAUTHORIZED"
    );
  });
});

describe("whether the collector is scraping anything", () => {
  it("fails when the connector has stored no reading of any target", () => {
    expect(statuses(facts({ seenInstances: [] }))).toMatchObject({
      answers_prometheus: "passed",
      scraping: "failed",
      matching: "unchecked"
    });
  });
});

describe("whether anything seen matches anything declared", () => {
  /**
   * Acceptance criterion 4, and the one that separates "the machine is dead" from "you spelled it
   * differently". Both lists travel, because the answer a person needs is the two side by side.
   */
  it("says what it sees and what was declared when none of them meet", () => {
    const mismatched = facts({ seenInstances: ["node-exporter:9100"], declaredHostnames: ["hub-vps"] });

    expect(findingFor(mismatched, "matching")).toEqual({
      step: "matching",
      status: "failed",
      code: null,
      evidence: { seen: ["node-exporter:9100"], declared: ["hub-vps"] }
    });
    expect(diagnoseConnector(mismatched).problem).toBe("matching");
  });

  it("matches character for character, because that is what the reading is joined on", () => {
    expect(
      statuses(facts({ seenInstances: ["Node-Exporter:9100"], declaredHostnames: ["node-exporter:9100"] }))
    ).toMatchObject({ matching: "failed" });
  });

  it("passes as soon as one of them meets, however many do not", () => {
    const partial = facts({
      seenInstances: ["node-exporter:9100", "cadvisor:8080"],
      declaredHostnames: ["node-exporter:9100"]
    });
    expect(statuses(partial)).toMatchObject({ matching: "passed" });
  });

  it("fails with nothing declared at all, which is what the discovery is for", () => {
    expect(statuses(facts({ declaredHostnames: [] }))).toMatchObject({ matching: "failed" });
  });

  it("reports each label once, in a stable order", () => {
    const noisy = facts({
      seenInstances: ["cadvisor:8080", "node-exporter:9100", "cadvisor:8080"],
      declaredHostnames: ["hub-vps", "hub-vps"]
    });
    expect(findingFor(noisy, "matching").evidence).toEqual({
      seen: ["cadvisor:8080", "node-exporter:9100"],
      declared: ["hub-vps"]
    });
  });
});

describe("what a finding is allowed to carry", () => {
  /**
   * Acceptance criterion 5, held at the layer that builds the sentence. The function is never
   * given an address, so no arrangement of its inputs can produce a response with one in it: the
   * tunnel command is composed on the screen out of what the person just typed into the form.
   */
  it("has no field an address could travel in", () => {
    for (const finding of diagnoseConnector(facts({ seenInstances: [], declaredHostnames: [] })).findings) {
      expect(Object.keys(finding).sort()).toEqual(["code", "evidence", "status", "step"]);
    }
  });

  it("leaves the evidence empty on a step that passed", () => {
    for (const finding of diagnoseConnector(facts()).findings) expect(finding.evidence).toEqual({});
  });
});

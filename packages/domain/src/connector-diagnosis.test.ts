import { describe, expect, it } from "vitest";
import {
  connectorDiagnosisSteps,
  couldNameMachine,
  diagnoseConnector,
  discoverInstances,
  discoverServices,
  servicesSeenOnHost,
  type ConnectorDiagnosisFacts,
  type DeclaredMachine,
  type ConnectorDiagnosisStep,
  type DiagnosisStatus
} from "./connector-diagnosis.js";

/** Everything true. Each test spoils exactly the one fact it is about. */
const healthy: ConnectorDiagnosisFacts = {
  missingMigrations: [],
  originAllowlisted: true,
  lastAttempt: { ok: true, code: null },
  connectorType: "prometheus",
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

describe("whether the call can even be constructed", () => {
  /**
   * The failure the screen meets most often: a connector whose credential nobody has written yet.
   * Before this rung existed it landed on the catch-all and read as "something answers on that
   * port, but it is not a Prometheus" -- with the address rung reported as passed on the account
   * of a call that never left the process.
   */
  it.each(["CREDENTIAL_MISSING", "INVALID_CONFIG", "OPERATION_NOT_DECLARED"])(
    "stops at %s, before anything is said about the network",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        allowlist: "passed",
        prepared: "failed",
        reachable: "unchecked",
        answers: "unchecked"
      });
    }
  );

  it("carries the code so the screen can say which of them it was", () => {
    expect(findingFor(facts({ lastAttempt: { ok: false, code: "CREDENTIAL_MISSING" } }), "prepared").code).toBe(
      "CREDENTIAL_MISSING"
    );
  });

  /** A call that got past the preparation proves it: whatever it needed, it had. */
  it("passes when a run failed further up the chain", () => {
    expect(statuses(facts({ lastAttempt: { ok: false, code: "CONNECT_TIMEOUT" } }))).toMatchObject({
      prepared: "passed"
    });
  });
});

describe("whether anything answers at the far end", () => {
  /** Acceptance criterion 3: the tunnel is shut, and that is a different fact from a wrong port. */
  it.each(["CONNECT_TIMEOUT", "CONNECTION_FAILED", "CONNECTION_RESET", "TIMEOUT", "DNS_RESOLUTION_FAILED"])(
    "reads %s as nothing answering",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        allowlist: "passed",
        prepared: "passed",
        reachable: "failed",
        answers: "unchecked"
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
      prepared: "passed",
      reachable: "unknown",
      answers: "unchecked"
    });
  });

  it("still refuses the origin without a check, because that answer needs no far end", () => {
    expect(statuses(facts({ lastAttempt: null, originAllowlisted: false }))).toMatchObject({ allowlist: "failed" });
  });

  it("does not know where a failure without a code belongs", () => {
    expect(statuses(facts({ lastAttempt: { ok: false, code: null } }))).toMatchObject({ reachable: "unknown" });
  });
});

describe("whether what answers is what the connector expects", () => {
  it.each(["INVALID_RESPONSE", "NOT_FOUND", "UNAUTHORIZED", "SERVER_ERROR", "RESPONSE_TOO_LARGE"])(
    "reads %s as something else on that port",
    (code) => {
      expect(statuses(facts({ lastAttempt: { ok: false, code } }))).toMatchObject({
        reachable: "passed",
        answers: "failed",
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
      answers: "failed"
    });
  });

  it("carries the code so the screen can say which of them it was", () => {
    expect(findingFor(facts({ lastAttempt: { ok: false, code: "UNAUTHORIZED" } }), "answers").code).toBe(
      "UNAUTHORIZED"
    );
  });
});

describe("how far a connector climbs", () => {
  /**
   * The two last rungs reason about prometheus record shapes, and an n8n's records carry neither
   * an `instance` label nor a hostname to join it against. Climbing them anyway would report as a
   * failure what is only a reading the chain was never built to interpret -- which is exactly the
   * class of lie this check exists to end.
   */
  it("stops a connector that is not prometheus at the answer rung", () => {
    const diagnosis = diagnoseConnector(facts({ connectorType: "n8n" }));
    expect(diagnosis.findings.map((finding) => finding.step)).toEqual([
      "migrations",
      "allowlist",
      "prepared",
      "reachable",
      "answers"
    ]);
    expect(diagnosis.problem).toBeNull();
  });

  it("climbs the whole chain for a prometheus connector", () => {
    expect(diagnoseConnector(facts()).findings.map((finding) => finding.step)).toEqual([...connectorDiagnosisSteps]);
  });
});

describe("whether the collector is scraping anything", () => {
  it("fails when the connector has stored no reading of any target", () => {
    expect(statuses(facts({ seenInstances: [] }))).toMatchObject({
      answers: "passed",
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

describe("what a collector can see that nobody has declared", () => {
  const machine = (hostId: string, name: string, hostname: string): DeclaredMachine => ({ hostId, name, hostname });

  const vps = machine("host-1", "VPS principal", "vps-1");
  const laptop = machine("host-2", "Portatil de proves", "laptop");

  it("names the machine a label was already declared against", () => {
    const found = discoverInstances({ seenInstances: ["vps-1"], declaredMachines: [vps, laptop] });

    expect(found).toEqual([{ label: "vps-1", declaredAs: { hostId: "host-1", name: "VPS principal" } }]);
  });

  it("leaves a label nobody has declared open, which is the whole point of looking", () => {
    const found = discoverInstances({ seenInstances: ["node-exporter:9100"], declaredMachines: [vps] });

    expect(found).toEqual([{ label: "node-exporter:9100", declaredAs: null }]);
  });

  /**
   * Character for character, exactly as the `matching` rung compares and exactly as a reading is
   * joined to a machine. A label that is nearly right matches nothing, and this screen exists
   * because "nearly right" is what somebody typed the first time.
   */
  it("does not call a near miss a match", () => {
    const found = discoverInstances({ seenInstances: ["vps-1:9100"], declaredMachines: [vps] });

    expect(found).toEqual([{ label: "vps-1:9100", declaredAs: null }]);
  });

  it("says nothing about a machine declared that nothing has been seen for", () => {
    const found = discoverInstances({ seenInstances: ["vps-1"], declaredMachines: [vps, laptop] });

    expect(found.map((item) => item.label)).toEqual(["vps-1"]);
  });

  it("lists each label once and in a settled order, however the readings came back", () => {
    const found = discoverInstances({
      seenInstances: ["web-2", "vps-1", "web-2", "api-3"],
      declaredMachines: [vps]
    });

    expect(found.map((item) => item.label)).toEqual(["api-3", "vps-1", "web-2"]);
  });

  it("sees nothing when the collector has stored nothing", () => {
    expect(discoverInstances({ seenInstances: [], declaredMachines: [vps] })).toEqual([]);
  });
});

/**
 * C4. The same idea as `discoverInstances` one level down, so the tests ask the same kinds of
 * question: what is offered, what is withheld, and what the proposal says about a thing nobody
 * has claimed.
 */
describe("the services a collector has seen", () => {
  const seen = (externalId: string, seenOn: string | null = null) => ({ externalId, seenOn });

  it("proposes a container by the name a person would recognise, not by the key", () => {
    const found = discoverServices({ seenRecords: [seen("container:n8n")], declaredMatchKeys: [] });

    expect(found).toEqual([
      { matchKey: "container:n8n", kind: "container", name: "n8n", seenOn: null, declared: false }
    ]);
  });

  it("gives a probe the kind of the thing it is, which is not the prefix it arrived under", () => {
    const found = discoverServices({
      seenRecords: [seen("probe:https://n8n.example.tld/healthz")],
      declaredMatchKeys: []
    });

    expect(found[0]).toMatchObject({ kind: "http", name: "https://n8n.example.tld/healthz" });
  });

  it("has somewhere to put a backup, which is the whole reason the kind exists", () => {
    const found = discoverServices({ seenRecords: [seen("backup:hub-vps-daily")], declaredMatchKeys: [] });

    expect(found[0]).toMatchObject({ kind: "backup", name: "hub-vps-daily" });
  });

  it("marks what somebody already declared, so the list never offers it twice", () => {
    const found = discoverServices({
      seenRecords: [seen("container:n8n"), seen("container:traefik")],
      declaredMatchKeys: ["container:n8n"]
    });

    expect(found.map((service) => [service.matchKey, service.declared])).toEqual([
      ["container:n8n", true],
      ["container:traefik", false]
    ]);
  });

  /**
   * A machine is the C3's question and a workflow is not infrastructure at all. Offering either
   * here would put a thing on the screen that the declaring dialog cannot store.
   */
  it("leaves out the prefixes that are not services", () => {
    const found = discoverServices({
      seenRecords: [seen("host:node-exporter:9100"), seen("workflow:42"), seen("container:n8n")],
      declaredMatchKeys: []
    });

    expect(found.map((service) => service.matchKey)).toEqual(["container:n8n"]);
  });

  /**
   * The label belongs to the collector that saw the container -- cAdvisor -- and not to the
   * machine, which is named by its `node_exporter`. Nothing in the data joins the two, so the
   * list carries it through rather than guessing.
   */
  it("carries the label of whoever saw it, so two machines can be told apart", () => {
    const found = discoverServices({
      seenRecords: [seen("container:n8n", "cadvisor:8080")],
      declaredMatchKeys: []
    });

    expect(found[0]!.seenOn).toBe("cadvisor:8080");
  });

  it("falls back to the whole key when the bare name would be too short for the column", () => {
    const found = discoverServices({ seenRecords: [seen("container:db")], declaredMatchKeys: [] });

    expect(found[0]!.name).toBe("container:db");
  });

  it("trims a name the column could not hold, rather than proposing one that fails to save", () => {
    const long = "a".repeat(200);
    const found = discoverServices({ seenRecords: [seen(`container:${long}`)], declaredMatchKeys: [] });

    expect(found[0]!.name).toHaveLength(120);
    expect(found[0]!.matchKey).toBe(`container:${long}`);
  });

  it("lists each key once and in a settled order, however the readings came back", () => {
    const found = discoverServices({
      seenRecords: [seen("probe:b"), seen("container:z"), seen("probe:b"), seen("container:a")],
      declaredMatchKeys: []
    });

    expect(found.map((service) => service.matchKey)).toEqual(["container:a", "container:z", "probe:b"]);
  });

  it("offers nothing when the collector has stored nothing", () => {
    expect(discoverServices({ seenRecords: [], declaredMatchKeys: [] })).toEqual([]);
  });
});

describe("what could name a machine at all", () => {
  it("accepts an address on a network, which is how a machine is named", () => {
    expect(couldNameMachine("node-exporter:9100")).toBe(true);
    expect(couldNameMachine("127.0.0.1:9090")).toBe(true);
    expect(couldNameMachine("cadvisor:8080")).toBe(true);
  });

  it("refuses a probed URL, which can never carry a machine's figures", () => {
    expect(couldNameMachine("https://sssupabase.example.com/storage/v1/version")).toBe(false);
    expect(couldNameMachine("http://example.com/healthz")).toBe(false);
  });

  it("refuses a label with nothing in it", () => {
    expect(couldNameMachine("")).toBe(false);
    expect(couldNameMachine("   ")).toBe(false);
  });
});

/**
 * C8. What a machine can be said to run, given the labels it answers to.
 *
 * The questions worth asking here are the two that were wrong before it existed: that nothing is
 * attributed by a coincidence of collectors, and that a machine's own hostname counts as one of
 * its labels without anybody having to write it down twice.
 */
describe("what the collectors have seen on one machine", () => {
  const seen = (externalId: string, seenOn: string | null = null) => ({ externalId, seenOn });

  it("takes what arrived on a label the machine answers to", () => {
    const found = servicesSeenOnHost({
      labels: ["node-exporter:9100", "cadvisor:8080"],
      records: [seen("container:n8n", "cadvisor:8080")],
      declaredMatchKeys: []
    });

    expect(found.map((service) => service.matchKey)).toEqual(["container:n8n"]);
  });

  /** Two exporters on one computer say nothing to us about being one computer. Somebody says it. */
  it("leaves out what arrived on a label nobody claimed", () => {
    const found = servicesSeenOnHost({
      labels: ["node-exporter:9100"],
      records: [seen("container:n8n", "cadvisor:8080")],
      declaredMatchKeys: []
    });

    expect(found).toEqual([]);
  });

  it("leaves out a reading that says nothing about where it was seen", () => {
    const found = servicesSeenOnHost({
      labels: ["node-exporter:9100"],
      records: [seen("probe:https://n8n.example.tld/healthz")],
      declaredMatchKeys: []
    });

    expect(found).toEqual([]);
  });

  it("marks what somebody has already declared, and still hands it over", () => {
    const found = servicesSeenOnHost({
      labels: ["cadvisor:8080"],
      records: [seen("container:n8n", "cadvisor:8080"), seen("container:traefik", "cadvisor:8080")],
      declaredMatchKeys: ["container:n8n"]
    });

    expect(found.map((service) => [service.matchKey, service.declared])).toEqual([
      ["container:n8n", true],
      ["container:traefik", false]
    ]);
  });

  it("finds nothing on a machine no collector has seen anything on", () => {
    expect(servicesSeenOnHost({ labels: ["node-exporter:9100"], records: [], declaredMatchKeys: [] })).toEqual([]);
  });
});

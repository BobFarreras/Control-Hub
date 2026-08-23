import { readFileSync } from "node:fs";
import { parseKeyRing } from "@control-hub/config";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { ControlHubAuth } from "./auth.js";

/**
 * The document, checked against the routes rather than written beside them.
 *
 * A hand-maintained API description drifts from the API within one increment, and nobody notices
 * until an integrator follows it into a 404. These tests hold the two properties that make the
 * generated document worth publishing: every connector route is described in words, and the
 * document describes the deployment it was generated from — a build without a key ring must not
 * advertise the credential routes it does not declare.
 */

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const stubAuth = { close: () => Promise.resolve() } as unknown as ControlHubAuth;
const base = {
  databaseUrl: "postgres://localhost:1/missing",
  redisUrl: "redis://localhost:1",
  auth: stubAuth,
  invitationAuth: stubAuth,
  appOrigin: "http://localhost"
};

const keyRing = () =>
  parseKeyRing(JSON.stringify({ activeKeyId: "2026-08", keys: { "2026-08": Buffer.alloc(32, 7).toString("base64") } }));

type Operation = { tags?: string[]; summary?: string; responses?: Record<string, { content?: unknown }> };
type Document = {
  info?: { version?: string };
  tags?: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
};

async function documentOf(options: Parameters<typeof buildApp>[0]): Promise<Document> {
  const app = buildApp(options);
  apps.push(app);
  await app.ready();
  return app.swagger() as unknown as Document;
}

/** Method and path as OpenAPI spells them: `{instanceId}`, not Fastify's `:instanceId`. */
const documented = [
  ["get", "/api/v1/connectors"],
  ["get", "/api/v1/integrations"],
  ["post", "/api/v1/integrations"],
  ["get", "/api/v1/integrations/{instanceId}"],
  ["patch", "/api/v1/integrations/{instanceId}"],
  ["post", "/api/v1/integrations/{instanceId}/enable"],
  ["post", "/api/v1/integrations/{instanceId}/disable"],
  ["post", "/api/v1/integrations/{instanceId}/health-checks"],
  ["get", "/api/v1/integrations/{instanceId}/runs"],
  ["get", "/api/v1/integrations/{instanceId}/credentials"],
  ["put", "/api/v1/integrations/{instanceId}/credentials/{kind}"],
  ["delete", "/api/v1/integrations/{instanceId}/credentials/{kind}"],
  ["post", "/api/v1/integrations/{instanceId}/credentials/{kind}/promote"],
  ["get", "/api/v1/integrations/{instanceId}/endpoints"],
  ["post", "/api/v1/integrations/{instanceId}/endpoints"],
  ["delete", "/api/v1/integrations/{instanceId}/endpoints/{endpointId}"],
  ["post", "/api/v1/webhooks/{publicId}"]
] as const;

/** The infrastructure module, behind its own flag and so generated into its own document. */
const documentedInfrastructure = [
  ["get", "/api/v1/infrastructure/overview"],
  ["get", "/api/v1/infrastructure/automations"],
  ["put", "/api/v1/infrastructure/automations/{instanceId}/{externalId}/link"],
  ["get", "/api/v1/infrastructure/inventory"],
  ["get", "/api/v1/infrastructure/connectors/{instanceId}/diagnosis"],
  ["get", "/api/v1/infrastructure/connectors/{instanceId}/discovery"],
  ["get", "/api/v1/infrastructure/connectors/{instanceId}/services"],
  ["get", "/api/v1/infrastructure/hosts"],
  ["post", "/api/v1/infrastructure/hosts"],
  ["get", "/api/v1/infrastructure/hosts/{hostId}"],
  ["patch", "/api/v1/infrastructure/hosts/{hostId}"],
  ["post", "/api/v1/infrastructure/hosts/{hostId}/services"],
  ["get", "/api/v1/infrastructure/services"],
  ["post", "/api/v1/infrastructure/services"],
  ["patch", "/api/v1/infrastructure/services/{serviceId}"],
  ["delete", "/api/v1/infrastructure/services/{serviceId}"],
  ["get", "/api/v1/infrastructure/alert-rules"],
  ["post", "/api/v1/infrastructure/alert-rules"],
  ["patch", "/api/v1/infrastructure/alert-rules/{ruleId}"],
  ["delete", "/api/v1/infrastructure/alert-rules/{ruleId}"],
  ["get", "/api/v1/infrastructure/alerts"],
  ["post", "/api/v1/infrastructure/alerts/{alertId}/acknowledge"],
  ["post", "/api/v1/infrastructure/alerts/{alertId}/resolve"]
] as const;

const withConnectors = { ...base, featureFlags: new Set(["connectors"] as const), connectorKeyRing: keyRing() };
const withInfrastructure = { ...base, featureFlags: new Set(["infrastructure"] as const) };

describe("openapi document", () => {
  /**
   * The document said `0.1.0` for the whole of `v0.2.0`, because the version was a literal
   * written beside the registration and nothing made it wrong when the release moved. This reads
   * the manifest rather than repeating a number, so the only way to break it is to break the
   * wiring, not to forget a file.
   */
  it("says which version it is, and agrees with the manifest", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const document = await documentOf(withConnectors);

    expect(document.info?.version).toBe(manifest.version);
  });

  it("describes every connector route with a tag and a summary", async () => {
    const document = await documentOf(withConnectors);

    const undescribed = documented.filter(([method, path]) => {
      const operation = document.paths[path]?.[method];
      return !operation?.tags?.length || !operation.summary;
    });
    expect(undescribed).toEqual([]);
  });

  it("uses only tags the document declares, so nothing lands in an unnamed group", async () => {
    const document = await documentOf(withConnectors);
    const declared = new Set((document.tags ?? []).map((tag) => tag.name));

    const orphans = documented.flatMap(([method, path]) =>
      (document.paths[path]?.[method]?.tags ?? []).filter((tag) => !declared.has(tag))
    );
    expect(orphans).toEqual([]);
  });

  /**
   * The property the description of `buildApp` explains: in Fastify a response schema is also the
   * serialiser, so a field missing from it disappears from the answer. Declaring one here would
   * make this document able to silently edit what the API returns — on, among others, the single
   * response in this API that carries a secret. The shapes live in the specification instead.
   */
  it("declares no response body schema, because that schema would be the serialiser", async () => {
    const document = await documentOf(withConnectors);

    const serialised = documented.filter(([method, path]) =>
      Object.values(document.paths[path]?.[method]?.responses ?? {}).some((response) => response.content)
    );
    expect(serialised).toEqual([]);
  });

  /**
   * The document is generated per deployment, so it has to be true of that deployment. Without a
   * key ring the credential, endpoint and webhook routes are not declared, and a document that
   * listed them anyway would send an integrator to an address that answers 404.
   */
  it("omits what a deployment without a key ring does not declare", async () => {
    const document = await documentOf({ ...base, featureFlags: new Set(["connectors"] as const) });

    expect(document.paths["/api/v1/integrations"]?.get).toBeDefined();
    expect(document.paths["/api/v1/integrations/{instanceId}/credentials"]).toBeUndefined();
    expect(document.paths["/api/v1/integrations/{instanceId}/endpoints"]).toBeUndefined();
    expect(document.paths["/api/v1/webhooks/{publicId}"]).toBeUndefined();
  });

  it("omits the whole surface while the flag is off", async () => {
    const document = await documentOf({ ...base, featureFlags: new Set() });

    const present = documented.filter(([method, path]) => document.paths[path]?.[method]);
    expect(present).toEqual([]);
  });
  /**
   * The same two properties for the infrastructure surface, and one that is only about it: with
   * the flag off there is no route to describe, so an operator reading the document of a
   * deployment that does not carry the module is never sent to one of these addresses.
   */
  it("describes every infrastructure route with a tag and a summary", async () => {
    const document = await documentOf(withInfrastructure);

    const undescribed = documentedInfrastructure.filter(([method, path]) => {
      const operation = document.paths[path]?.[method];
      return !operation?.tags?.length || !operation.summary;
    });
    expect(undescribed).toEqual([]);
  });

  it("declares no response body schema on the infrastructure routes either", async () => {
    const document = await documentOf(withInfrastructure);

    const serialised = documentedInfrastructure.filter(([method, path]) =>
      Object.values(document.paths[path]?.[method]?.responses ?? {}).some((response) => response.content)
    );
    expect(serialised).toEqual([]);
  });

  /**
   * The list above is a whitelist, and a whitelist that falls behind checks nothing: the eight
   * inventory routes of increment B2 shipped undocumented precisely because nothing noticed they
   * were missing from it. This makes forgetting to add a route the failure, rather than a route
   * quietly escaping every property the tests above assert.
   */
  it("lists every infrastructure route there is, so none escapes the checks above", async () => {
    const document = await documentOf(withInfrastructure);
    const listed = new Set(documentedInfrastructure.map(([method, path]) => `${method} ${path}`));

    const missing = Object.entries(document.paths)
      .filter(([path]) => path.startsWith("/api/v1/infrastructure"))
      .flatMap(([path, operations]) =>
        Object.keys(operations ?? {})
          .map((method) => `${method} ${path}`)
          .filter((entry) => !listed.has(entry))
      );
    expect(missing).toEqual([]);
  });

  it("omits the infrastructure surface while its flag is off", async () => {
    const document = await documentOf(withConnectors);

    const present = documentedInfrastructure.filter(([method, path]) => document.paths[path]?.[method]);
    expect(present).toEqual([]);
  });
});

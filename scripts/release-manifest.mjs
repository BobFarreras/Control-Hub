/**
 * The release manifest: the one artefact an installation ever reads about a version other than
 * the one it is running.
 *
 * Everything an update needs has to be in here, because by design there is nothing else to ask.
 * `docs/specifications/deployment.md` (D5) makes the daily check a `GET` of a static file with no
 * request body, no identifier and no version sent -- so the file cannot be tailored to the caller,
 * and whatever it does not say, nobody can go and look up.
 *
 * That is also why the shape is validated here rather than trusted. This file is produced once by
 * a workflow and then read by every installation for as long as the version is current: a digest
 * with a typo does not fail here, it fails months later on somebody's server, at the point where
 * the person reading the error has the least context to make sense of it.
 *
 * The image references look like the exception to «no URLs» and are not. An image reference says
 * where to pull from; it is not somewhere the installation reports to. Nothing in the manifest
 * describes who installed it, and nothing asks for an answer.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The four images a release publishes. `deploy/Dockerfile` declares a stage for each. */
export const releaseServices = ["api", "worker", "migrate", "web"];

/** What P6 will refuse to read rather than guess at, if the shape ever changes. */
export const manifestSchema = 1;

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const commitPattern = /^[0-9a-f]{40}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function reject(reason) {
  throw new Error(`RELEASE_MANIFEST_INVALID: ${reason}`);
}

/**
 * What work an update represents, from the paths that changed between the previous version and
 * this one.
 *
 * The banner exists to say this and not merely that something newer exists, so the two signals it
 * needs are computed at publication time -- when the two commits are both at hand -- rather than
 * left for an installation to work out from a version number, which it cannot.
 *
 * Counting changed migration paths is the same as counting new ones here, and only because
 * `AGENTS.md` forbids editing a published migration. If that rule ever went, this count would
 * quietly start including edits and the number would stop meaning what it says.
 */
export function releaseWork(changedPaths) {
  if (!Array.isArray(changedPaths)) reject("changed paths must be a list");
  return {
    migrations: changedPaths.filter((path) => /^packages\/database\/migrations\/[^/]+\.sql$/.test(path)).length,
    // Not a guess at which variable: `.env.example` is the file the runbook tells somebody to
    // compare against, so if it moved there is configuration work, and if it did not there is none.
    configuration: changedPaths.includes(".env.example")
  };
}

/** The manifest itself, refusing anything it cannot vouch for rather than publishing it. */
export function buildManifest({ version, commit, released, registry, digests, work }) {
  if (!versionPattern.test(String(version))) reject(`version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH`);
  if (!commitPattern.test(String(commit))) reject("commit must be a full 40 character sha");
  if (!instantPattern.test(String(released))) reject("released must be an ISO 8601 instant in UTC");
  if (!registry || /\/$/.test(registry)) reject("registry must be a namespace without a trailing slash");
  // Lowercase because a registry namespace is case sensitive and a GitHub owner is not: pushing as
  // `BobFarreras` and pulling as `bobfarreras` are two different repositories, and the second one
  // does not exist.
  if (registry !== registry.toLowerCase()) reject(`registry ${registry} must be lowercase`);

  const images = {};
  for (const service of releaseServices) {
    const digest = digests?.[service];
    if (!digest) reject(`no digest for ${service}`);
    if (!digestPattern.test(digest)) reject(`digest for ${service} is not a sha256 digest`);
    images[service] = `${registry}/control-hub-${service}@${digest}`;
  }
  const extra = Object.keys(digests ?? {}).filter((service) => !releaseServices.includes(service));
  if (extra.length > 0) reject(`unknown service ${extra.join(", ")}`);

  if (!Number.isInteger(work?.migrations) || work.migrations < 0) reject("migrations must be a count");
  if (typeof work?.configuration !== "boolean") reject("configuration must be true or false");

  return {
    schema: manifestSchema,
    version,
    released,
    commit,
    images,
    work: { migrations: work.migrations, configuration: work.configuration }
  };
}

/**
 * Reads a manifest back, and validates it by rebuilding it.
 *
 * This is the direction that matters for safety. Writing a manifest happens once, inside a workflow
 * we control; reading one happens on every installation, from a file fetched over the network. So
 * the parse does not trust any field: it pulls the pieces apart, hands them to the same builder that
 * produced them, and compares. Anything that does not survive the round trip was not a manifest this
 * project wrote.
 *
 * The registry check is the point of the exercise. Four images that each look plausible but do not
 * share a namespace is not a shape a release can have and is exactly the shape a substituted image
 * would have.
 */
export function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    reject("not JSON");
  }
  if (parsed?.schema !== manifestSchema) reject(`unknown schema ${JSON.stringify(parsed?.schema)}`);

  const digests = {};
  const registries = new Set();
  for (const service of releaseServices) {
    const reference = parsed.images?.[service];
    if (typeof reference !== "string") reject(`no image for ${service}`);
    const separator = reference.lastIndexOf("@");
    if (separator === -1) reject(`image for ${service} is not pinned by digest`);
    const repository = reference.slice(0, separator);
    if (!repository.endsWith(`/control-hub-${service}`)) reject(`image for ${service} is named ${repository}`);
    registries.add(repository.slice(0, -`/control-hub-${service}`.length));
    digests[service] = reference.slice(separator + 1);
  }
  if (registries.size !== 1) reject(`images come from ${registries.size} registries`);

  const rebuilt = buildManifest({
    version: parsed.version,
    commit: parsed.commit,
    released: parsed.released,
    registry: [...registries][0],
    digests,
    work: parsed.work
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(parsed)) reject("does not survive being rebuilt");
  return rebuilt;
}

/**
 * The manifest as the variables `compose.release.yaml` reads.
 *
 * Generated rather than written by hand for the usual reason -- a digest nobody can read is a digest
 * nobody can proofread -- and regenerated whole on every update, so a variable left over from a
 * previous version cannot survive into the next one.
 */
export function manifestEnvironment(manifest) {
  return [
    `CONTROL_HUB_VERSION=${manifest.version}`,
    ...releaseServices.map((service) => `CONTROL_HUB_${service.toUpperCase()}_IMAGE=${manifest.images[service]}`)
  ];
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * The paths that changed since the previous version tag.
 *
 * With no previous tag every path counts as changed, which is right: a first release brings every
 * migration it has, and saying «no migrations» would be the one wrong answer.
 */
export function changedSincePreviousTag(tag) {
  const tags = git("tag", "--list", "v*.*.*", "--sort=-version:refname")
    .split("\n")
    .filter(Boolean)
    .filter((candidate) => candidate !== tag);
  const previous = tags[0];
  const range = previous ? `${previous}..${tag}` : tag;
  const output = previous ? git("diff", "--name-only", range) : git("ls-tree", "-r", "--name-only", tag);
  return { previous: previous ?? null, paths: output.split("\n").filter(Boolean) };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = argument("tag") ?? reject("missing --tag");
  const version = tag.replace(/^v/, "");
  const { previous, paths } = changedSincePreviousTag(tag);
  const manifest = buildManifest({
    version,
    commit: git("rev-parse", `${tag}^{commit}`),
    released: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    registry: (argument("registry") ?? reject("missing --registry")).toLowerCase(),
    digests: JSON.parse(argument("digests") ?? reject("missing --digests")),
    work: releaseWork(paths)
  });
  const out = argument("out") ?? "release.json";
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${out}: ${version} from ${previous ?? "no previous tag"}, ${paths.length} paths changed\n`);
}

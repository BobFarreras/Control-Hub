/**
 * The release manifest, as the running installation reads it.
 *
 * `scripts/release-manifest.mjs` writes this file; this reads it back. The two are deliberately
 * separate programs. The writer runs inside a workflow, in plain Node, on a checkout that has not
 * been built -- it cannot import a workspace package without making publication depend on a
 * successful build of the thing being published. The reader runs inside the worker, in TypeScript,
 * and has to refuse anything it cannot vouch for.
 *
 * Two implementations of one shape is a real risk and it is answered rather than accepted:
 * `release.test.ts` builds manifests with the publisher's own code and parses them with this one,
 * so the day either side drifts, the suite says so.
 *
 * The validation is strict for a reason that is not tidiness. This arrives over the network from
 * a host nobody here controls, and what it produces is a sentence on somebody's screen telling
 * them to update a production installation. A manifest that is merely plausible must not become
 * that sentence.
 */

/** The four images a release publishes. `deploy/Dockerfile` declares a stage for each. */
export const releaseServices = ["api", "worker", "migrate", "web"] as const;
export type ReleaseService = (typeof releaseServices)[number];

/** The shape this code understands. Anything else is refused rather than guessed at. */
export const releaseManifestSchema = 1;

export type ReleaseManifest = {
  schema: typeof releaseManifestSchema;
  version: string;
  released: string;
  commit: string;
  images: Record<ReleaseService, string>;
  /** What the update represents, computed at publication time from the paths that changed. */
  work: { migrations: number; configuration: boolean };
};

/**
 * A published version newer than the one this installation runs, reduced to what a person needs.
 *
 * Note what is not here: no image, no digest, no URL to fetch. Nothing on a screen leads to an
 * action that changes the installation -- that is invariant 2, and the alternative wants the
 * Docker socket. The banner reads this and says what the work is; a person types the command.
 */
export type ReleaseSummary = {
  version: string;
  released: string;
  /** How many migrations the update brings, which is most of what «how risky is this» means. */
  migrations: number;
  /** Whether `.env.example` moved, which is the only honest signal that configuration changed. */
  configuration: boolean;
};

/**
 * The whole of what an installation remembers about looking.
 *
 * `available: null` is a real answer and not an absent one -- it means the check ran and found
 * nothing newer -- which is why `checkedAt` sits outside it. A screen that can say «checked this
 * morning, nothing new» is saying something; one that renders nothing is indistinguishable from
 * a check that has been broken for a month.
 */
export type UpdateCheckState = { checkedAt: string; available: ReleaseSummary | null };

/**
 * Where the worker leaves what it found and the API picks it up.
 *
 * In Valkey rather than in a table, and the reason is what this value is rather than convenience.
 * It is a fact about a file on somebody else's server, true until the next look; it belongs to
 * the installation and to no tenant, so a row in a tenant-scoped schema would have to invent an
 * owner for it. It survives a restart, expires on its own if nobody looks again, and costs no
 * migration -- which for a fact this disposable is the right trade in every direction.
 *
 * The key is here because it is an agreement between two processes, the same as a queue name.
 */
export const updateCheckStateKey = "control-hub:installation:update-check";

/**
 * How long a result stays worth showing. A week: long enough that a check failing for a few days
 * does not hide a pending update, short enough that a check broken for a month goes quiet instead
 * of insisting on a version somebody may already be running.
 */
export const updateCheckStateTtlSeconds = 7 * 24 * 60 * 60;

/**
 * Reads back what was stored, answering null for anything unexpected.
 *
 * Lenient where `parseReleaseManifest` is strict, and deliberately so: this value did not come
 * over the network, it came from the process next door. The failure this guards against is a
 * release that changed the shape while the old value was still cached, and the right answer to
 * that is to forget it and let the next check write a new one.
 */
export function parseUpdateCheckState(text: string): UpdateCheckState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const state = parsed as Record<string, unknown>;
  if (typeof state.checkedAt !== "string" || !instantPattern.test(state.checkedAt)) return null;
  if (state.available === null) return { checkedAt: state.checkedAt, available: null };
  if (typeof state.available !== "object") return null;
  const available = state.available as Record<string, unknown>;
  if (typeof available.version !== "string" || !versionPattern.test(available.version)) return null;
  if (typeof available.released !== "string" || !instantPattern.test(available.released)) return null;
  if (!Number.isInteger(available.migrations) || (available.migrations as number) < 0) return null;
  if (typeof available.configuration !== "boolean") return null;
  return {
    checkedAt: state.checkedAt,
    available: {
      version: available.version,
      released: available.released,
      migrations: available.migrations as number,
      configuration: available.configuration
    }
  };
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const commitPattern = /^[0-9a-f]{40}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class ReleaseManifestError extends Error {
  constructor(reason: string) {
    super(`RELEASE_MANIFEST_INVALID: ${reason}`);
    this.name = "ReleaseManifestError";
  }
}

function reject(reason: string): never {
  throw new ReleaseManifestError(reason);
}

/**
 * Rebuilds a manifest from its own pieces, in the order the publisher writes them.
 *
 * The order matters because the check below is string equality on the serialised form, which is
 * what makes a field nobody validated impossible to smuggle through: an extra key survives every
 * field check and does not survive this one.
 */
function rebuild(manifest: ReleaseManifest): string {
  return JSON.stringify({
    schema: manifest.schema,
    version: manifest.version,
    released: manifest.released,
    commit: manifest.commit,
    images: Object.fromEntries(releaseServices.map((service) => [service, manifest.images[service]])),
    work: { migrations: manifest.work.migrations, configuration: manifest.work.configuration }
  });
}

/**
 * Reads a manifest, and validates it by rebuilding it.
 *
 * The registry check is the point of the exercise. Four images that each look plausible but do
 * not share a namespace is not a shape a release can have, and is exactly the shape a substituted
 * image would have. The worker never pulls anything, so this is not what makes an image safe --
 * `deploy/update.sh` validates again, on the file it acts on -- but a manifest that fails here is
 * one nobody should be told about either.
 */
export function parseReleaseManifest(text: string): ReleaseManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    reject("not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) reject("not an object");
  const candidate = parsed as Record<string, unknown>;
  if (candidate.schema !== releaseManifestSchema) reject(`unknown schema ${JSON.stringify(candidate.schema)}`);

  const version = candidate.version;
  if (typeof version !== "string" || !versionPattern.test(version))
    reject(`version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH`);
  const commit = candidate.commit;
  if (typeof commit !== "string" || !commitPattern.test(commit)) reject("commit must be a full 40 character sha");
  const released = candidate.released;
  if (typeof released !== "string" || !instantPattern.test(released))
    reject("released must be an ISO 8601 instant in UTC");

  const declared = candidate.images;
  if (typeof declared !== "object" || declared === null) reject("no images");
  const images = declared as Record<string, unknown>;
  const registries = new Set<string>();
  const resolved: Record<string, string> = {};
  for (const service of releaseServices) {
    const reference = images[service];
    if (typeof reference !== "string") reject(`no image for ${service}`);
    const separator = reference.lastIndexOf("@");
    if (separator === -1) reject(`image for ${service} is not pinned by digest`);
    const repository = reference.slice(0, separator);
    if (!digestPattern.test(reference.slice(separator + 1))) reject(`image for ${service} is not a sha256 digest`);
    const suffix = `/control-hub-${service}`;
    if (!repository.endsWith(suffix)) reject(`image for ${service} is named ${repository}`);
    const registry = repository.slice(0, -suffix.length);
    // Lowercase because a registry namespace is case sensitive where a GitHub owner is not:
    // pushing as `BobFarreras` and pulling as `bobfarreras` are two different repositories.
    if (!registry || registry !== registry.toLowerCase() || registry.endsWith("/"))
      reject(`registry ${JSON.stringify(registry)} is not a namespace`);
    registries.add(registry);
    resolved[service] = reference;
  }
  if (registries.size !== 1) reject(`images come from ${registries.size} registries`);

  const declaredWork = candidate.work;
  if (typeof declaredWork !== "object" || declaredWork === null) reject("no work");
  const work = declaredWork as Record<string, unknown>;
  if (!Number.isInteger(work.migrations) || (work.migrations as number) < 0) reject("migrations must be a count");
  if (typeof work.configuration !== "boolean") reject("configuration must be true or false");

  const manifest: ReleaseManifest = {
    schema: releaseManifestSchema,
    version,
    released,
    commit,
    images: resolved,
    work: { migrations: work.migrations as number, configuration: work.configuration }
  };
  if (rebuild(manifest) !== JSON.stringify(candidate)) reject("does not survive being rebuilt");
  return manifest;
}

/**
 * Whether `candidate` is a later version than `installed`.
 *
 * Ordering rather than inequality, and the difference is the whole value of the comparison. An
 * installation running a build from `develop` reports the version of the tag it came after, so
 * string inequality would be right; but an installation deliberately held on a later build, or
 * one whose manifest fetch resolved to a stale mirror, would be told to «update» to something
 * older. A banner that tells somebody to go backwards is worse than no banner.
 *
 * Anything that is not MAJOR.MINOR.PATCH answers false. There is no version it could be compared
 * against, and refusing to guess is the only safe answer.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const left = versionPattern.exec(candidate);
  const right = versionPattern.exec(installed);
  if (!left || !right) return false;
  for (let part = 1; part <= 3; part++) {
    const a = Number(left[part]);
    const b = Number(right[part]);
    if (a !== b) return a > b;
  }
  return false;
}

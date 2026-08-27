import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const secretFileErrorCodes = [
  "SECRET_SOURCE_CONFLICT",
  "SECRET_FILE_PATH_INVALID",
  "SECRET_FILE_NOT_FOUND",
  "SECRET_FILE_SYMLINK",
  "SECRET_FILE_NOT_REGULAR",
  // No `SECRET_FILE_CHANGED`: it reported that the path pointed somewhere else by the time the
  // file was opened, and nothing opens a path twice any more, so it could only ever be raised by
  // a check that no longer exists. A code in this list that cannot be produced reads like a case
  // somebody has to handle.
  "SECRET_FILE_TOO_LARGE",
  "SECRET_FILE_EMPTY",
  "SECRET_FILE_PERMISSIONS",
  "SECRET_FILE_UNREADABLE"
] as const;

export type SecretFileErrorCode = (typeof secretFileErrorCodes)[number];

export class SecretFileError extends Error {
  constructor(
    readonly code: SecretFileErrorCode,
    readonly variable: string
  ) {
    super(`${variable}: ${code}`);
    this.name = "SecretFileError";
  }
}

type ResolveSecretFileOptions = {
  maxBytes?: number;
  environment?: string | undefined;
  platform?: NodeJS.Platform;
};

export const runtimeSecretVariables = [
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "CONNECTOR_KEY_RING",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_SECRET"
] as const;

export function secretFileVariable(variable: string): string {
  return `${variable}_FILE`;
}

function fail(code: SecretFileErrorCode, variable: string): never {
  throw new SecretFileError(code, variable);
}

/**
 * Opens the path and reports why it could not be opened, without asking anything about the path
 * first. `O_NOFOLLOW` turns a symlink into `ELOOP` at the syscall itself, which is the whole
 * reason the refusal can happen here rather than in a check somebody has to trust.
 */
function openSecretFile(variable: string, filePath: string, platform: NodeJS.Platform): number {
  const noFollow = platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  try {
    return openSync(filePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === "ELOOP") fail("SECRET_FILE_SYMLINK", variable);
    if (errno === "ENOENT" || errno === "ENOTDIR") fail("SECRET_FILE_NOT_FOUND", variable);
    if (errno === "EISDIR") fail("SECRET_FILE_NOT_REGULAR", variable);
    return fail("SECRET_FILE_UNREADABLE", variable);
  }
}

function readSecretFile(variable: string, filePath: string, options: ResolveSecretFileOptions): string {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const platform = options.platform ?? process.platform;
  if (!isAbsolute(filePath) || filePath.includes("\0")) fail("SECRET_FILE_PATH_INVALID", variable);

  // Every decision below is taken from the open descriptor and none from the path. The shape
  // before this one asked the path first, opened it, and then compared device and inode numbers
  // to catch a swap in between -- which did work, but it meant the code carried a window it had
  // to keep proving harmless, and that proof lives in a reader's head rather than in the file.
  // Opening first has no window: whatever the name points at afterwards, the bytes read here come
  // from the object the kernel already handed over.
  const descriptor = openSecretFile(variable, filePath, platform);
  try {
    const stats = fstatSync(descriptor);
    // Windows has no `O_NOFOLLOW`, so a symlink opens there and is caught after the fact. The
    // path is asked about only once the descriptor is held and is never opened again, so this is
    // a diagnostic on a decision already made, not a check anything can race.
    if (platform === "win32" && lstatSync(filePath).isSymbolicLink()) fail("SECRET_FILE_SYMLINK", variable);
    if (!stats.isFile()) fail("SECRET_FILE_NOT_REGULAR", variable);
    if (options.environment === "production" && platform !== "win32" && (stats.mode & 0o077) !== 0)
      fail("SECRET_FILE_PERMISSIONS", variable);
    if (stats.size > maxBytes) fail("SECRET_FILE_TOO_LARGE", variable);
    const value = readFileSync(descriptor, "utf8").replace(/\r?\n$/, "");
    if (Buffer.byteLength(value, "utf8") > maxBytes) fail("SECRET_FILE_TOO_LARGE", variable);
    if (value.length === 0 || value.includes("\0")) fail("SECRET_FILE_EMPTY", variable);
    return value;
  } catch (error) {
    if (error instanceof SecretFileError) throw error;
    return fail("SECRET_FILE_UNREADABLE", variable);
  } finally {
    closeSync(descriptor);
  }
}

export function resolveSecretFiles(
  source: NodeJS.ProcessEnv,
  variables: readonly string[],
  options: ResolveSecretFileOptions = {}
): NodeJS.ProcessEnv {
  const resolved = { ...source };
  for (const variable of variables) {
    const fileVariable = secretFileVariable(variable);
    const direct = source[variable];
    const filePath = source[fileVariable];
    const hasDirect = direct !== undefined && direct !== "";
    const hasFile = filePath !== undefined && filePath !== "";
    if (hasDirect && hasFile) fail("SECRET_SOURCE_CONFLICT", variable);
    if (hasFile) resolved[variable] = readSecretFile(variable, filePath, options);
    delete resolved[fileVariable];
  }
  return resolved;
}

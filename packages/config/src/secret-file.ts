import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const secretFileErrorCodes = [
  "SECRET_SOURCE_CONFLICT",
  "SECRET_FILE_PATH_INVALID",
  "SECRET_FILE_NOT_FOUND",
  "SECRET_FILE_SYMLINK",
  "SECRET_FILE_NOT_REGULAR",
  "SECRET_FILE_CHANGED",
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

function readSecretFile(variable: string, filePath: string, options: ResolveSecretFileOptions): string {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const platform = options.platform ?? process.platform;
  if (!isAbsolute(filePath) || filePath.includes("\0")) fail("SECRET_FILE_PATH_INVALID", variable);

  let before;
  try {
    before = lstatSync(filePath);
  } catch {
    fail("SECRET_FILE_NOT_FOUND", variable);
  }
  if (before.isSymbolicLink()) fail("SECRET_FILE_SYMLINK", variable);
  if (!before.isFile()) fail("SECRET_FILE_NOT_REGULAR", variable);
  if (before.size > maxBytes) fail("SECRET_FILE_TOO_LARGE", variable);
  if (options.environment === "production" && platform !== "win32" && (before.mode & 0o077) !== 0)
    fail("SECRET_FILE_PERMISSIONS", variable);

  let descriptor: number | undefined;
  try {
    const noFollow = platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    descriptor = openSync(filePath, constants.O_RDONLY | noFollow);
    const after = fstatSync(descriptor);
    if (!after.isFile()) fail("SECRET_FILE_NOT_REGULAR", variable);
    if (platform !== "win32" && (before.dev !== after.dev || before.ino !== after.ino))
      fail("SECRET_FILE_CHANGED", variable);
    if (options.environment === "production" && platform !== "win32" && (after.mode & 0o077) !== 0)
      fail("SECRET_FILE_PERMISSIONS", variable);
    if (after.size > maxBytes) fail("SECRET_FILE_TOO_LARGE", variable);
    const value = readFileSync(descriptor, "utf8").replace(/\r?\n$/, "");
    if (Buffer.byteLength(value, "utf8") > maxBytes) fail("SECRET_FILE_TOO_LARGE", variable);
    if (value.length === 0 || value.includes("\0")) fail("SECRET_FILE_EMPTY", variable);
    return value;
  } catch (error) {
    if (error instanceof SecretFileError) throw error;
    return fail("SECRET_FILE_UNREADABLE", variable);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
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

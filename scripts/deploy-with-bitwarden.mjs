#!/usr/bin/env node
import { resolve } from "node:path";
import { deployWithBitwarden } from "./lib/bitwarden-secrets.mjs";

function value(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
}

try {
  const separator = process.argv.indexOf("--");
  if (separator === -1) throw new Error("Missing deployment command after --");
  const options = process.argv.slice(2, separator);
  deployWithBitwarden({
    bwsCommand: value(options, "--bws"),
    command: process.argv.slice(separator + 1),
    manifestPath: resolve(value(options, "--manifest")),
    secretsRoot: resolve(value(options, "--secrets-root"))
  });
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "BITWARDEN_DEPLOY_INVALID";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}

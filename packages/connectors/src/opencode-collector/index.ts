#!/usr/bin/env node
import { collect, CollectorError, validateConfig } from "./collector.js";

try {
  const result = await collect(validateConfig(process.env));
  process.stdout.write(`OpenCode usage delivered: ${result.delivered}\n`);
} catch (error) {
  const code = error instanceof CollectorError ? error.code : "COLLECTOR_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}

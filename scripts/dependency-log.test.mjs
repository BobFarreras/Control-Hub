/**
 * What the dependency log has to get right before it is worth reading.
 *
 * The log's whole claim is that it is derived: nobody types it, so nobody can quietly stop
 * typing it. That claim rests on two pieces of parsing -- reading what a commit bumped, and
 * deciding how big the bump was -- and both are guesses about text somebody else generates.
 * These are the cases that were actually in this repository's history on the day it was
 * written, plus the ones that would silently produce a wrong category rather than an error.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, parseCommit, renderLog } from "./dependency-log.mjs";

test("classify reads the size of a bump from the two versions", () => {
  assert.equal(classify("5.9.3", "6.0.3"), "major");
  assert.equal(classify("5.11.1", "5.12.0"), "minor");
  assert.equal(classify("9.14.0", "9.14.1"), "patch");
});

test("classify treats a leading zero release the way semver does", () => {
  // Below 1.0.0 the minor position carries the breaking changes, which is exactly what
  // `lucide-react` did going from 0.548.0 to 1.31.0. Calling that a minor would put the most
  // dangerous updates in the pile nobody reads.
  assert.equal(classify("0.548.0", "1.31.0"), "major");
  assert.equal(classify("0.548.0", "0.549.0"), "major");
  assert.equal(classify("0.548.0", "0.548.1"), "patch");
});

test("classify survives a version that is not three numbers", () => {
  // Docker tags are versions with opinions attached.
  assert.equal(classify("22.16-alpine", "26.7-alpine"), "major");
  assert.equal(classify("22.16-alpine", "22.17-alpine"), "minor");
  assert.equal(classify("nonsense", "6.0.0"), "unknown");
});

test("parseCommit reads a single package bump", () => {
  const entries = parseCommit("chore(deps): bump ioredis from 5.11.1 to 6.0.0 (#22)", "");
  assert.deepEqual(entries, [{ name: "ioredis", from: "5.11.1", to: "6.0.0" }]);
});

test("parseCommit reads a docker bump, without swallowing the directory", () => {
  const entries = parseCommit("chore(docker): bump node from 22.16-alpine to 26.7-alpine in /deploy", "");
  assert.deepEqual(entries, [{ name: "node", from: "22.16-alpine", to: "26.7-alpine" }]);
});

test("parseCommit opens a grouped update instead of counting it as one", () => {
  /**
   * The grouped pull request is the one that matters most here: its subject names no package at
   * all, so a parser that only reads subjects records "10 updates" as a single anonymous line
   * and the log stops being an inventory.
   */
  const subject = "chore(deps): bump the minor-and-patch group across 1 directory with 10 updates (#25)";
  const body = [
    "Bumps the minor-and-patch group with 10 updates:",
    "",
    "Updates `fastify` from 5.6.1 to 5.7.0",
    "Updates `better-auth` from 1.4.2 to 1.5.0",
    "Updates `tsx` from 4.20.1 to 4.20.3"
  ].join("\n");

  assert.deepEqual(parseCommit(subject, body), [
    { name: "fastify", from: "5.6.1", to: "5.7.0" },
    { name: "better-auth", from: "1.4.2", to: "1.5.0" },
    { name: "tsx", from: "4.20.1", to: "4.20.3" }
  ]);
});

test("parseCommit ignores a commit that is not a dependency bump", () => {
  assert.deepEqual(parseCommit("feat(connectors): let an integration be retired, not only stopped", ""), []);
  assert.deepEqual(parseCommit("docs(state): the 7.1 branch is closed", "Updates the state file"), []);
});

test("renderLog groups by how dangerous the update was, majors first", () => {
  const markdown = renderLog([
    { name: "ioredis", from: "5.11.1", to: "6.0.0", date: "2026-08-16", commit: "abc1234" },
    { name: "fastify", from: "5.6.1", to: "5.7.0", date: "2026-08-16", commit: "def5678" },
    { name: "pino", from: "9.14.0", to: "9.14.1", date: "2026-08-15", commit: "aaa1111" }
  ]);

  assert.match(markdown, /## Major/);
  assert.match(markdown, /## Minor/);
  assert.match(markdown, /## Patch/);
  assert.ok(markdown.indexOf("## Major") < markdown.indexOf("## Minor"), "majors come first");
  assert.match(markdown, /ioredis/);
  assert.match(markdown, /5\.11\.1/);
});

test("renderLog says a category is empty rather than omitting it", () => {
  // A missing heading reads as "we have not checked", which is the opposite of what an empty
  // category means. It means nothing broke that way.
  const markdown = renderLog([{ name: "pino", from: "9.14.0", to: "9.14.1", date: "2026-08-15", commit: "aaa1111" }]);
  assert.match(markdown, /## Major/);
  assert.match(markdown, /Cap/);
});

test("renderLog carries no accented vowels, because product documents here do not", () => {
  const markdown = renderLog([{ name: "pino", from: "9.14.0", to: "9.14.1", date: "2026-08-15", commit: "aaa1111" }]);
  assert.doesNotMatch(markdown, /[àèéíòóúÀÈÉÍÒÓÚ]/);
});

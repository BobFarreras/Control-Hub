import postgres from "postgres";

/**
 * Throws away the end to end database and creates it empty again.
 *
 * The authenticated suite has to be able to run against a database with nothing in it, because
 * that is the only thing CI ever runs against. A local database that has been seeded a dozen
 * times carries a dozen runs of accumulated rows, and a test that quietly depends on one of them
 * passes here and fails there -- which is exactly how three red CI runs got past a green local
 * check. Re-seeding on top does not reproduce it: only an empty database does.
 *
 * Dropping a database is not something to be clever about, so there are four guards and every
 * one of them refuses rather than repairs:
 *
 * - `--confirm-test`, so this can never be reached by a stray `pnpm` argument.
 * - Never in production.
 * - Only a local host, because a remote database is somebody's environment.
 * - Only a name ending in `_e2e`, the same rule `seed-e2e.ts` applies, so the name itself has to
 *   say out loud that the database exists to be thrown away.
 */

if (!process.argv.includes("--confirm-test")) throw new Error("The end to end reset requires --confirm-test");
if (process.env.NODE_ENV === "production") throw new Error("The end to end reset is disabled in production");

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname))
  throw new Error("The end to end reset only accepts a local database");

const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
// Belt as well as braces: the name is interpolated into DDL, which takes no parameters, so it
// is checked against a shape that cannot carry anything but a database name.
if (!/^[a-z][a-z0-9_]*_e2e$/.test(name))
  throw new Error(`The end to end reset only accepts a database whose name ends in _e2e, got ${name}`);

/**
 * The drop has to be issued from somewhere other than the database being dropped, so this
 * connects to the cluster's maintenance database with the same credentials. `with (force)`
 * terminates whatever is still connected -- a dev server left running, a pooled connection
 * from the last run -- instead of failing with "database is being accessed by other users".
 */
const maintenance = new URL(databaseUrl);
maintenance.pathname = "/postgres";

const sql = postgres(maintenance.toString(), { max: 1 });
try {
  await sql.unsafe(`drop database if exists "${name}" with (force)`);
  await sql.unsafe(`create database "${name}"`);
  console.log(`Recreated ${name}. It is empty: migrate and seed before running anything against it.`);
} finally {
  await sql.end({ timeout: 5 });
}

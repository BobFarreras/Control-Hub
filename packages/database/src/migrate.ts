import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrationFingerprint } from "./migration-fingerprint.js";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations");

const migrationsDirectory = dirname(fileURLToPath(new URL("../migrations/.keep", import.meta.url)));
const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql`select pg_advisory_lock(hashtext('control-hub:migrations'))`;
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const name of files) {
    const migration = await readFile(join(migrationsDirectory, name), "utf8");
    const checksum = createHash("sha256").update(migrationFingerprint(migration)).digest("hex");
    const [existing] = await sql<{ checksum: string }[]>`select checksum from schema_migrations where name = ${name}`;
    if (existing) {
      if (existing.checksum === checksum) continue;
      // Rows written before the fingerprint existed were hashed from the raw bytes. If that
      // older hash still matches, the file is provably unchanged and only the checkout's line
      // endings differ, so the row is repaired instead of blocking the deployment. A genuine
      // edit matches neither hash and still stops here.
      const legacyChecksum = createHash("sha256").update(migration).digest("hex");
      // An early local run of 0021 included one extra blank line at EOF. This compatibility
      // hash accepts only the current normalized migration plus that newline, never changed SQL.
      const trailingBlankChecksum = createHash("sha256")
        .update(`${migrationFingerprint(migration)}\n`)
        .digest("hex");
      if (existing.checksum === legacyChecksum || existing.checksum === trailingBlankChecksum) {
        await sql`update schema_migrations set checksum = ${checksum} where name = ${name}`;
        continue;
      }
      throw new Error(`Applied migration changed: ${name}`);
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into schema_migrations (name, checksum) values (${name}, ${checksum})`;
    });
  }
} finally {
  await sql`select pg_advisory_unlock(hashtext('control-hub:migrations'))`.catch(() => undefined);
  await sql.end({ timeout: 5 });
}

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
    const checksum = createHash("sha256").update(migration).digest("hex");
    const [existing] = await sql<{ checksum: string }[]>`select checksum from schema_migrations where name = ${name}`;
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
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

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

const migrationUrl = new URL("../migrations/0001_system_metadata.sql", import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), "utf8");
const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(migration);
  });
} finally {
  await sql.end({ timeout: 5 });
}

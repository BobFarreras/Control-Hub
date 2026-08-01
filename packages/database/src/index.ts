import postgres from "postgres";

export function createDatabaseClient(url: string) {
  return postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 5, prepare: false });
}

export async function checkDatabase(client: ReturnType<typeof createDatabaseClient>) {
  const startedAt = performance.now();
  await client`select 1`;
  return Math.round(performance.now() - startedAt);
}

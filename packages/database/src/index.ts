import postgres from "postgres";

export function createDatabaseClient(url: string) {
  return postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 5, prepare: false });
}

export async function checkDatabase(client: ReturnType<typeof createDatabaseClient>) {
  const startedAt = performance.now();
  await client`select 1`;
  return Math.round(performance.now() - startedAt);
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export async function withTenant<T>(
  client: DatabaseClient,
  tenantId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const result = await client.begin(async (transaction) => {
    await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
    return operation(transaction);
  });
  return result as T;
}

export * from "./schema-probes.js";

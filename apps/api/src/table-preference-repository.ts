import { withTenant, type DatabaseClient } from "@control-hub/database";
import type { TenantContext } from "@control-hub/domain";

export type TablePreference = { tableId: string; columnOrder: string[]; hiddenColumns: string[]; columnWidths: Record<string, number>; pageSize: 10 | 25 | 50 | 100 };
const defaults = (tableId: string): TablePreference => ({ tableId, columnOrder: [], hiddenColumns: [], columnWidths: {}, pageSize: 25 });

export async function getTablePreference(database: DatabaseClient, context: TenantContext, tableId: string) {
  return withTenant(database, context.tenantId, async (tx) => { const rows = await tx<TablePreference[]>`select table_id as "tableId", column_order as "columnOrder", hidden_columns as "hiddenColumns", column_widths as "columnWidths", page_size as "pageSize" from user_table_preferences where tenant_id = ${context.tenantId} and user_id = ${context.userId} and table_id = ${tableId}`; return rows[0] ?? defaults(tableId); });
}

export async function saveTablePreference(database: DatabaseClient, context: TenantContext, preference: TablePreference) {
  return withTenant(database, context.tenantId, async (tx) => { const rows = await tx<TablePreference[]>`insert into user_table_preferences (tenant_id, user_id, table_id, column_order, hidden_columns, column_widths, page_size) values (${context.tenantId}, ${context.userId}, ${preference.tableId}, ${tx.json(preference.columnOrder)}, ${tx.json(preference.hiddenColumns)}, ${tx.json(preference.columnWidths)}, ${preference.pageSize}) on conflict (tenant_id, user_id, table_id) do update set column_order = excluded.column_order, hidden_columns = excluded.hidden_columns, column_widths = excluded.column_widths, page_size = excluded.page_size, updated_at = now() returning table_id as "tableId", column_order as "columnOrder", hidden_columns as "hiddenColumns", column_widths as "columnWidths", page_size as "pageSize"`; return rows[0]!; });
}

/** The columns a user is allowed to reorder, hide or resize, per table. Anything outside
 *  this list is rejected rather than stored, so a preference cannot name an unknown column. */
export const tableColumns = {
  "crm.leads": ["name", "company", "status", "priority", "created", "actions"],
  "crm.customers": ["name", "email", "phone", "status", "created"]
} as const;
export type TableId = keyof typeof tableColumns;

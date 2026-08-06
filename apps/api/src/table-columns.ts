/** The columns a user is allowed to reorder, hide or resize, per table. Anything outside
 *  this list is rejected rather than stored, so a preference cannot name an unknown column. */
export const tableColumns = {
  "crm.leads": ["name", "company", "status", "priority", "created", "actions"],
  "crm.customers": ["name", "email", "phone", "status", "created"],
  "support.tickets": ["reference", "subject", "customer", "status", "priority", "assignee", "due"],
  "projects.list": ["code", "name", "customer", "status", "owner", "due", "logged"]
} as const;
export type TableId = keyof typeof tableColumns;

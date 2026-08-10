import type { CustomerDetail } from "./api-types";

export function customerOverview(customer: CustomerDetail) {
  const openTasks = customer.tasks.filter((task) => !task.completedAt);
  const nextTask = [...openTasks].sort((left, right) => {
    if (!left.dueAt) return 1;
    if (!right.dueAt) return -1;
    return Date.parse(left.dueAt) - Date.parse(right.dueAt);
  })[0];
  return {
    primaryContact: customer.contacts.find((contact) => contact.isPrimary) ?? customer.contacts[0] ?? null,
    nextTask: nextTask ?? null,
    lastActivity: customer.activity[0] ?? null,
    openTaskCount: openTasks.length,
    contactCount: customer.contacts.length
  };
}

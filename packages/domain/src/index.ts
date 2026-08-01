export type TenantContext = Readonly<{ tenantId: string; actorId: string; permissions: ReadonlySet<string> }>;

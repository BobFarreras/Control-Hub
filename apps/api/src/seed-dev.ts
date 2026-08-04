import { createHash } from "node:crypto";
import { createDatabaseClient } from "@control-hub/database";

if (!process.argv.includes("--confirm-local")) throw new Error("Development seed requires --confirm-local");
if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production");
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.pathname !== "/control_hub")
  throw new Error("Development seed only accepts the local control_hub database");

function id(scope: string) {
  const value = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}
const database = createDatabaseClient(databaseUrl);

try {
  const tenants = await database<
    { tenant_id: string; user_id: string }[]
  >`select m.tenant_id, m.user_id from memberships m join membership_roles mr on mr.membership_id = m.id join roles r on r.id = mr.role_id and r.tenant_id = m.tenant_id where m.status = 'active' and r.code = 'owner' order by m.created_at limit 1`;
  const target = tenants[0];
  if (!target) throw new Error("Bootstrap an Owner before running the development seed");
  const tenantId = target.tenant_id;
  const leads = [
    ["Alba Roca", "Roca Studio", "alba.roca@example.test", "new", "normal"],
    ["Bruno Costa", "Costa Legal", "bruno.costa@example.test", "contacted", "high"],
    ["Carla Vidal", "Vidal Labs", "carla.vidal@example.test", "qualified", "urgent"],
    ["Daniel Serra", "Serra Digital", "daniel.serra@example.test", "proposal", "high"],
    ["Eva Soler", "Soler Retail", "eva.soler@example.test", "lost", "low"],
    ["Ferran Puig", "Puig Systems", "ferran.puig@example.test", "new", "normal"],
    ["Gemma Bosch", "Bosch Atelier", "gemma.bosch@example.test", "contacted", "normal"],
    ["Hugo Martin", "Martin Cloud", "hugo.martin@example.test", "qualified", "high"],
    ["Irene Casas", "Casas Health", "irene.casas@example.test", "proposal", "urgent"],
    ["Jordi Prat", "Prat Finance", "jordi.prat@example.test", "new", "low"],
    ["Katia Mora", "Mora Apps", "katia.mora@example.test", "contacted", "high"],
    ["Leo Navarro", "Navarro Media", "leo.navarro@example.test", "qualified", "normal"]
  ] as const;
  for (const [name, company, email, status, priority] of leads)
    await database`insert into leads (id, tenant_id, name, normalized_name, company_name, email, normalized_email, source, status, priority) values (${id(`${tenantId}:lead:${email}`)}, ${tenantId}, ${name}, ${name.toLowerCase()}, ${company}, ${email}, ${email}, 'development-seed', ${status}, ${priority}) on conflict do nothing`;
  const customers = [
    ["Avant Operations", "ops@avant.example.test", "+34931000001"],
    ["Nordic Commerce", "finance@nordic.example.test", "+34931000002"],
    ["Delta Works", "hello@delta.example.test", "+34931000003"],
    ["Lumen Agency", "admin@lumen.example.test", "+34931000004"],
    ["Vertex Labs", "team@vertex.example.test", "+34931000005"],
    ["Orbit Systems", "billing@orbit.example.test", "+34931000006"]
  ] as const;
  for (const [name, email, phone] of customers)
    await database`insert into customers (id, tenant_id, display_name, normalized_name, billing_email, normalized_billing_email, phone, normalized_phone) values (${id(`${tenantId}:customer:${email}`)}, ${tenantId}, ${name}, ${name.toLowerCase()}, ${email}, ${email}, ${phone}, ${phone}) on conflict do nothing`;
  const products = [
    ["automation-suite", "Automation Suite", "Automatitzacions i fluxos empresarials"],
    ["business-web", "Business Web", "Web corporativa gestionada"],
    ["ai-agent", "AI Agent", "Agent especialitzat per processos interns"]
  ] as const;
  for (const [code, name, description] of products) {
    const productId = id(`${tenantId}:product:${code}`);
    const versionId = id(`${tenantId}:version:${code}`);
    const planId = id(`${tenantId}:plan:${code}`);
    await database`insert into products (id, tenant_id, code, name, description) values (${productId}, ${tenantId}, ${code}, ${name}, ${description}) on conflict do nothing`;
    await database`insert into product_versions (id, tenant_id, product_id, version, status, released_at) values (${versionId}, ${tenantId}, ${productId}, '1.0.0', 'active', now()) on conflict do nothing`;
    await database`insert into plans (id, tenant_id, product_version_id, code, name) values (${planId}, ${tenantId}, ${versionId}, ${`${code}-pro`}, 'Professional') on conflict do nothing`;
    await database`insert into plan_prices (id, tenant_id, plan_id, currency, amount_minor, cost_minor, tax_basis_points, billing_interval, effective_from) values (${id(`${tenantId}:price:${code}`)}, ${tenantId}, ${planId}, 'EUR', ${code === "business-web" ? 14900 : 9900}, 2500, 2100, 'monthly', now() - interval '30 days') on conflict do nothing`;
  }
  for (let index = 0; index < 3; index++) {
    const customerEmail = customers[index]![1];
    const code = products[index]![0];
    await database`insert into subscriptions (id, tenant_id, customer_id, plan_id, price_id, quantity, started_at, current_period_start, renewal_at, renewal_alert_days) values (${id(`${tenantId}:subscription:${index}`)}, ${tenantId}, ${id(`${tenantId}:customer:${customerEmail}`)}, ${id(`${tenantId}:plan:${code}`)}, ${id(`${tenantId}:price:${code}`)}, 1, now() - interval '45 days', now() - interval '15 days', now() + interval '15 days', 21) on conflict do nothing`;
  }
  const expenses = [
    ["OpenAI", "API Platform", "api", 4500, "monthly", "https://platform.openai.com"],
    ["Hetzner", "Production VPS", "infrastructure", 3290, "monthly", "https://console.hetzner.cloud"],
    ["n8n", "Automation", "saas", 24000, "annual", "https://n8n.io"],
    ["Cloudflare", "Domains and DNS", "domain", 1800, "annual", "https://dash.cloudflare.com"]
  ] as const;
  for (const [provider, service, category, amount, interval, website] of expenses)
    await database`insert into company_subscriptions (id, tenant_id, provider, service_name, category, currency, amount_minor, billing_interval, renewal_at, auto_renew, website_url) values (${id(`${tenantId}:expense:${provider}:${service}`)}, ${tenantId}, ${provider}, ${service}, ${category}, 'EUR', ${amount}, ${interval}, now() + interval '21 days', true, ${website}) on conflict do nothing`;
  // Support: the schedule and targets first, because a ticket copies the targets when it opens
  // and cannot be created without them.
  for (const weekday of [1, 2, 3, 4, 5])
    await database`insert into support_schedule (id, tenant_id, weekday, opens_at, closes_at) values (${id(`${tenantId}:schedule:${weekday}`)}, ${tenantId}, ${weekday}, '08:00', '16:00') on conflict do nothing`;
  const slaTargets = [
    ["low", 480, 4800],
    ["normal", 240, 2400],
    ["high", 60, 480],
    ["urgent", 15, 240]
  ] as const;
  for (const [priority, firstResponse, resolution] of slaTargets)
    await database`insert into sla_targets (id, tenant_id, priority, first_response_minutes, resolution_minutes, effective_from) values (${id(`${tenantId}:sla:${priority}`)}, ${tenantId}, ${priority}, ${firstResponse}, ${resolution}, '2020-01-01T00:00:00Z') on conflict do nothing`;

  const seededCustomers = await database<
    { id: string }[]
  >`select id from customers where tenant_id = ${tenantId} order by created_at limit 4`;
  const tickets = [
    ["El formulari de contacte no envia correus", "urgent", "open", 30],
    ["Actualitzar els textos de la pagina de preus", "low", "new", 6],
    ["L'automatitzacio de factures ha fallat dues vegades", "high", "waiting_customer", 20],
    ["Afegir un idioma nou a la web", "normal", "open", 3]
  ] as const;
  let ticketNumber = 0;
  for (const [subject, priority, status, hoursAgo] of tickets) {
    const customer = seededCustomers[ticketNumber % Math.max(1, seededCustomers.length)];
    if (!customer) break;
    ticketNumber += 1;
    const targets = slaTargets.find(([code]) => code === priority)!;
    await database`insert into tickets (id, tenant_id, ticket_number, customer_id, subject, description, status, priority, opened_at, first_response_target_minutes, resolution_target_minutes) values (${id(`${tenantId}:ticket:${subject}`)}, ${tenantId}, ${ticketNumber}, ${customer.id}, ${subject}, 'Exemple de desenvolupament.', ${status}, ${priority}, now() - ${`${hoursAgo} hours`}::interval, ${targets[1]}, ${targets[2]}) on conflict do nothing`;
  }
  await database`insert into ticket_counters (tenant_id, next_number) values (${tenantId}, ${tickets.length + 1}) on conflict (tenant_id) do update set next_number = greatest(ticket_counters.next_number, ${tickets.length + 1})`;

  console.log(
    `Development examples ready for tenant ${tenantId}: ${leads.length} leads, ${customers.length} customers, ${products.length} products, 3 customer subscriptions, ${expenses.length} expenses, ${tickets.length} tickets.`
  );
} finally {
  await database.end({ timeout: 5 });
}

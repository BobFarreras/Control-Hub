import { getDictionary, getInfrastructureDictionary, isLocale } from "@control-hub/i18n";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { HostDetail } from "@/components/host-detail";
import { PageTopbar } from "@/components/page-topbar";
import { ServiceSelector } from "@/components/service-selector";
import { apiFetch, readJson } from "@/lib/api";
import type {
  ConnectorInstance,
  InfrastructureInventoryResponse,
  IntegrationsResponse,
  ObservedHost
} from "@/lib/api-types";
import { featureEnabled } from "@/lib/features";
import { readingAge, readingFigures } from "@/lib/infrastructure";
import { requireSession } from "@/lib/require-session";

/**
 * One machine, on a page of its own.
 *
 * A VPS with fifteen services does not fit in a card on a list of machines, which is the whole
 * reason this route exists. What it adds to what the list already shows is provenance: which
 * collector read each line and when, so that a figure nobody trusts can be traced to the thing
 * that produced it instead of being argued about.
 *
 * It reads the same inventory the list reads and picks one machine out of it. There is no route
 * per host on the API and there should not be: the answer is the same answer, and a second
 * endpoint computing it would be a second chance to compute it differently.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, increment C2.
 */

type Loaded = { host: ObservedHost | null; instanceNames: Record<string, string>; canOperate: boolean };

/**
 * Whether this session may declare, asked of the API rather than assumed from the page.
 *
 * The selector is the only thing here that writes, and a screen that offers an action the server
 * will refuse is worse than one that does not offer it.
 */
async function canOperate(): Promise<boolean> {
  const response = await apiFetch("/api/v1/me");
  if (!response.ok) return false;
  const payload = await readJson<{ context: { permissions: string[] } }>(response);
  return payload.context.permissions.includes("infrastructure:operate");
}

async function load(hostId: string): Promise<Loaded> {
  try {
    const [inventoryResponse, integrationsResponse, operate] = await Promise.all([
      apiFetch("/api/v1/infrastructure/inventory"),
      apiFetch("/api/v1/integrations"),
      canOperate()
    ]);
    if (!inventoryResponse.ok) return { host: null, instanceNames: {}, canOperate: false };

    const { inventory } = await readJson<InfrastructureInventoryResponse>(inventoryResponse);
    // Names, not identifiers: the page says a machine is read by "Prometheus de la VPS" rather
    // than by a row of a table. Without the integrations permission there are no names, and the
    // identifier is shown instead -- the same fallback the list of automations already makes.
    const integrations: ConnectorInstance[] = integrationsResponse.ok
      ? (await readJson<IntegrationsResponse>(integrationsResponse)).integrations
      : [];

    return {
      host: inventory.hosts.find((candidate) => candidate.id === hostId) ?? null,
      instanceNames: Object.fromEntries(integrations.map((instance) => [instance.id, instance.name])),
      canOperate: operate
    };
  } catch {
    return { host: null, instanceNames: {}, canOperate: false };
  }
}

export default async function HostPage({ params }: { params: Promise<{ locale: string; hostId: string }> }) {
  const { locale, hostId } = await params;
  if (!isLocale(locale)) notFound();
  if (!featureEnabled("infrastructure")) notFound();
  await requireSession(locale);

  const t = getDictionary(locale);
  const labels = getInfrastructureDictionary(locale) as unknown as Record<string, string>;
  const { host, instanceNames, canOperate: operate } = await load(hostId);

  // One instant for the whole page, as on the list: an age computed twice is an age that can read
  // differently in two places on one screen.
  const now = new Date();

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow!}
          title={host ? host.name : labels.title!}
          description={host ? host.hostname : labels.description}
          themeLabel={t.header.theme}
        />
        <main className="compact-main">
          <p>
            <Link className="link-button" href={`/${locale}/infrastructure`}>
              <ArrowLeft size={15} aria-hidden="true" />
              {labels.hostBack}
            </Link>
          </p>
          {host ? (
            <HostDetail
              host={{
                ...host,
                age: readingAge(host.reading.observedAt, now),
                figures: readingFigures(labels, locale, host.reading, now),
                services: host.services.map((service) => ({
                  ...service,
                  age: readingAge(service.reading.observedAt, now),
                  figures: readingFigures(labels, locale, service.reading, now)
                }))
              }}
              instanceNames={instanceNames}
              labels={labels}
            />
          ) : (
            <p className="muted">{labels.hostNotFound}</p>
          )}
          {host && operate && Object.keys(instanceNames).length > 0 && (
            <ServiceSelector
              hostId={host.id}
              collectors={Object.entries(instanceNames)
                .map(([value, label]) => ({ value, label }))
                .sort((one, other) => one.label.localeCompare(other.label))}
              labels={labels}
            />
          )}
        </main>
      </div>
    </div>
  );
}

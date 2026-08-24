import type { HostRow, ServiceRow } from "@/components/infrastructure-workspace";
import { StatusPill } from "@/components/status-pill";
import type { DiscoveredService, Reading } from "@/lib/api-types";
import { ageLabel, observedStateTone, type ReadingAge } from "@/lib/infrastructure";

/**
 * One machine, drawn whole.
 *
 * The list of machines shows a card each and has to stay readable at twenty of them; this shows
 * one and can afford the whole services table. What it adds is where every line came from: the
 * collector that read it and how long ago, side by side, so a figure that looks wrong can be
 * traced to the thing that produced it.
 *
 * A server component on purpose: this draws and does not act, and a component that only reads
 * should not ship a bundle to say so. Correcting a service still happens on the list, behind
 * `infrastructure:operate`. The one thing on this page that writes is the service selector, and
 * the page renders it beside this as its own island -- see `service-selector.tsx`.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, increments C2 and C4.
 */

type Labels = Record<string, string>;

/** `up` becomes `stateUp`: one derivation rather than a table to keep in step with the union. */
function capitalised(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Where a reading came from and when.
 *
 * The two halves of provenance are drawn together because either alone misleads: a fresh figure
 * from a collector nobody expected and an hour-old one from the right collector are different
 * problems, and telling them apart is the whole point of this page.
 */
function Provenance({
  reading,
  age,
  instanceNames,
  labels: t
}: {
  reading: Reading;
  age: ReadingAge | null;
  instanceNames: Record<string, string>;
  labels: Labels;
}) {
  const source = reading.instanceId ? (instanceNames[reading.instanceId] ?? reading.instanceId) : t.hostReadByNobody;

  return (
    <span className="infra-provenance">
      <StatusPill
        tone={observedStateTone[reading.state]}
        label={t[`state${capitalised(reading.state)}`] ?? reading.state}
      />
      <small className="muted">
        {t.hostReadBy} {source} · {ageLabel(t, age, t.observedNever ?? "")}
      </small>
    </span>
  );
}

function Figures({ figures }: { figures: HostRow["figures"] }) {
  if (figures.length === 0) return null;
  return (
    <dl className="infra-figures">
      {figures.map((figure) => (
        <div key={figure.field}>
          <dt>{figure.label}</dt>
          <dd>{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The other labels this machine answers to.
 *
 * Drawn beside its own because they are the reason anything below is attributed here at all: a
 * reader who wonders why a container belongs to this machine finds the answer in one line rather
 * than in the shape of a Prometheus configuration.
 */
function OtherLabels({ labels, title }: { labels: string[]; title: string }) {
  if (labels.length === 0) return null;
  return (
    <p className="infra-host-labels">
      <small className="muted">{title}</small>
      {labels.map((label) => (
        <code className="discovery-label" key={label}>
          {label}
        </code>
      ))}
    </p>
  );
}

/**
 * What the collectors have read under one of this machine's labels, declared or not.
 *
 * The section exists because declaring answers "I want alerts about this" and the page was using
 * it to answer "what is on this machine", which is a different question: a machine with twenty
 * containers and none of them declared was drawn as a machine with nothing on it. Declared ones
 * are marked rather than left out -- the difference matters to somebody asking why a thing that
 * is plainly down produced no alert.
 *
 * Only containers reach here. It is not a gap: a probe is about an address and a backup about a
 * job, and for neither of them is which machine ran it a property of the fact observed. Those
 * reach a machine by being declared services of it, and appear above.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, increment C8.
 */
function Observed({ observed, labels: t }: { observed: DiscoveredService[]; labels: Labels }) {
  return (
    <section className="project-panel" aria-label={t.sectionObserved ?? ""}>
      <header className="project-panel-heading">
        <h3>{t.sectionObserved}</h3>
        <small className="muted">{observed.length}</small>
      </header>
      <p className="muted">{t.observedAbout}</p>
      {observed.length === 0 ? (
        <p className="muted">{t.observedEmpty}</p>
      ) : (
        <ul className="collector-list">
          {observed.map((service) => (
            <li className="collector-row" key={service.matchKey}>
              <span className="ticket-subject">{service.name}</span>
              <small className="muted">{service.matchKey}</small>
              <span className="collector-row-state">
                <StatusPill
                  tone={observedStateTone[service.reading.state]}
                  label={t[`state${capitalised(service.reading.state)}`] ?? service.reading.state}
                />
                {service.declared && <small className="muted">{t.observedDeclaredMark}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HostDetail({
  host,
  instanceNames,
  labels: t
}: {
  host: HostRow;
  instanceNames: Record<string, string>;
  labels: Labels;
}) {
  return (
    <>
      <section className="project-panel" aria-label={host.name}>
        <header className="project-panel-heading">
          <h3>{t[`environment${capitalised(host.environment)}`] ?? host.environment}</h3>
          <Provenance reading={host.reading} age={host.age} instanceNames={instanceNames} labels={t} />
        </header>
        <Figures figures={host.figures} />
        <OtherLabels labels={host.labels} title={t.hostLabels ?? ""} />
        {host.notes && <p className="muted">{host.notes}</p>}
      </section>

      <section className="project-panel" aria-label={t.sectionServices}>
        <header className="project-panel-heading">
          <h3>{t.sectionServices}</h3>
          <small className="muted">
            {(t.hostServicesCount ?? "").replace("{count}", String(host.services.length))}
          </small>
        </header>
        {host.services.length === 0 ? (
          <p className="muted">{t.servicesEmpty}</p>
        ) : (
          <ul className="infra-services">
            {host.services.map((service: ServiceRow) => (
              <li key={service.id}>
                <header>
                  <div>
                    <span className="ticket-subject">{service.name}</span>
                    <small className="muted">
                      {t[`kind${capitalised(service.kind)}`] ?? service.kind} · {service.matchKey}
                    </small>
                  </div>
                  <Provenance reading={service.reading} age={service.age} instanceNames={instanceNames} labels={t} />
                </header>
                <Figures figures={service.figures} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Observed observed={host.observed} labels={t} />
    </>
  );
}

"use client";

import { Eye, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectField } from "@/components/form-field";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type { ConnectorServicesResponse, DiscoveredService } from "@/lib/api-types";
import { ask } from "@/lib/ask";
import { observedStateTone } from "@/lib/infrastructure";
import { errorMessage } from "@/lib/integrations";

/**
 * The services a collector can see, offered for somebody to tick.
 *
 * The C3 proposes machines and this proposes services: same idea one level down, and the same
 * rule behind it -- a service nobody claimed is noise, so the software shows what it has read and
 * a person decides. Before this, declaring one meant typing `container:n8n` by hand into a free
 * text field, and a single wrong character produced a service that simply never lit up, with
 * nothing on any screen to say why.
 *
 * The one interactive island on a page that is otherwise a server component: the machine's page
 * reads, and this is the only thing on it that writes.
 *
 * What it does not do is decide which machine a container belongs to. A container reading carries
 * the label of the cAdvisor that saw it and a machine is declared by its `node_exporter` label;
 * nothing joins the two. So everything the collector sees is offered, `seenOn` is shown beside it,
 * and the person who knows picks. Filtering on an invented correspondence would hide real services
 * without saying why.
 *
 * Specification: `docs/specifications/connector-onboarding.md`, "C4 -- El selector de serveis".
 */

type Labels = Record<string, string>;

/** `container` becomes `kindContainer`: one derivation rather than a table to keep in step. */
function capitalised(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function fill(template: string | undefined, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template ?? "");
}

export function ServiceSelector({
  hostId,
  collectors,
  labels: t
}: {
  hostId: string;
  collectors: { value: string; label: string }[];
  labels: Labels;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [instanceId, setInstanceId] = useState(collectors[0]?.value ?? "");
  const [seen, setSeen] = useState<DiscoveredService[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function look() {
    if (!instanceId) return;
    setBusy(true);
    const result = await ask<ConnectorServicesResponse>(`/api/v1/infrastructure/connectors/${instanceId}/services`);
    setBusy(false);
    if (!result.ok) {
      setSeen(null);
      return toast("error", errorMessage(t, result.code));
    }
    setSeen(result.data.services);
    setTicked(new Set());
  }

  async function declare() {
    const chosen = seen?.filter((service) => ticked.has(service.matchKey)) ?? [];
    if (chosen.length === 0) return toast("error", t.pickNothingTicked ?? "");

    setSaving(true);
    const result = await ask<unknown>(`/api/v1/infrastructure/hosts/${hostId}/services`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        services: chosen.map((service) => ({
          name: service.name,
          kind: service.kind,
          matchKey: service.matchKey,
          expectedState: "up"
        }))
      })
    });
    setSaving(false);

    if (!result.ok) return toast("error", errorMessage(t, result.code));

    toast("success", fill(t.pickDeclared, { count: chosen.length }));
    // Asking again rather than crossing them off here: the answer is the store's to give, and a
    // list edited in place would be this screen's opinion of what it just did.
    setTicked(new Set());
    await look();
    router.refresh();
  }

  function toggle(matchKey: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(matchKey)) next.delete(matchKey);
      else next.add(matchKey);
      return next;
    });
  }

  const undeclared = seen?.filter((service) => !service.declared) ?? [];
  // Grouped in the order the kinds are read in, not alphabetically: containers are what somebody
  // came here for, and a probe or a backup is the exception they scroll to.
  const groups = [...new Set(undeclared.map((service) => service.kind))];

  return (
    <section className="project-panel" aria-label={t.pickTitle}>
      <h3>{t.pickTitle}</h3>
      <p className="field-help">{t.pickAbout}</p>

      <div className="discovery-ask">
        <SelectField
          label={t.discoveryCollector ?? ""}
          name="pickCollector"
          value={instanceId}
          onChange={(event) => {
            setInstanceId(event.target.value);
            // The answer belonged to the collector it was asked of. Left on screen under another
            // name it would be one collector's services attributed to a different one.
            setSeen(null);
            setTicked(new Set());
          }}
          options={collectors}
        />
        <button className="secondary-button" onClick={() => void look()} disabled={busy || !instanceId} type="button">
          <Eye size={16} aria-hidden="true" />
          {busy ? t.pickRunning : t.pickRun}
        </button>
      </div>

      {!seen ? (
        <p className="crm-empty">{t.pickNotRun}</p>
      ) : seen.length === 0 ? (
        <p className="crm-empty">{t.pickEmpty}</p>
      ) : (
        <>
          <p className="field-help">{fill(t.pickCount, { seen: seen.length, undeclared: undeclared.length })}</p>

          {groups.map((kind) => (
            <fieldset className="infra-pick-group" key={kind}>
              <legend>{t[`kind${capitalised(kind)}`] ?? kind}</legend>
              {undeclared
                .filter((service) => service.kind === kind)
                .map((service) => (
                  <label className="infra-pick-row" key={service.matchKey}>
                    <input
                      type="checkbox"
                      checked={ticked.has(service.matchKey)}
                      onChange={() => toggle(service.matchKey)}
                    />
                    <span>
                      <strong>{service.name}</strong>
                      <small className="muted">
                        {service.matchKey}
                        {service.seenOn ? ` · ${fill(t.pickSeenOn, { label: service.seenOn })}` : ""}
                      </small>
                    </span>
                    {/* What it is doing right now, so the choice is made with the state in front
                        of the person making it rather than from a bare key. The same reading the
                        list of machines draws, decided by the same function. */}
                    <StatusPill
                      tone={observedStateTone[service.reading.state]}
                      label={t[`state${capitalised(service.reading.state)}`] ?? service.reading.state}
                    />
                  </label>
                ))}
            </fieldset>
          ))}

          {/* Already declared, shown and not offered: it is information, not an action. */}
          {seen.some((service) => service.declared) && (
            <ul className="infra-pick-declared">
              {seen
                .filter((service) => service.declared)
                .map((service) => (
                  <li key={service.matchKey}>
                    <StatusPill tone="done" label={t.pickAlreadyDeclared ?? ""} />
                    <small className="muted">{service.matchKey}</small>
                  </li>
                ))}
            </ul>
          )}

          {undeclared.length > 0 && (
            <button
              className="primary-button"
              onClick={() => void declare()}
              disabled={saving || ticked.size === 0}
              type="button"
            >
              <Plus size={16} aria-hidden="true" />
              {saving ? t.pickDeclaring : fill(t.pickDeclare, { count: ticked.size })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

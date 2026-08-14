"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectField, TextField, ToggleField } from "@/components/form-field";
import type { StatusTone } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import type { ConnectorConfigField, ConnectorRun } from "@/lib/api-types";
import { fieldValue, isChecked, type FormReader } from "@/lib/connector-config";
import {
  credentialKindHint,
  credentialKindLabel,
  fieldHint,
  fieldLabel,
  issueMessage,
  type Labels
} from "@/lib/connector-labels";
import { formValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";
import { errorMessage, problemCode } from "@/lib/integrations";

/**
 * What both integrations screens need from each other.
 *
 * The listing and the detail page are two routes now, and these are the pieces neither owns: the
 * shape of a call to this API, the words a state is drawn with, and the form a connector dictates.
 * They live here rather than being copied into each, because the copy is what silently stops
 * matching -- and a configuration form that differed between the dialog that creates an
 * integration and the page that edits one would be exactly the sort of difference nobody notices
 * until an operator does.
 *
 * Specification: `docs/specifications/connectors.md`.
 */
/** What the API says is wrong with a configuration: a path inside it and a code, never a value. */
export type ConfigIssue = { path: string; code: string };

export type Failure = { ok: false; code: string | null; issues: ConfigIssue[] };
export type Result<T> = { ok: true; data: T } | Failure;

export function readIssues(payload: unknown): ConfigIssue[] {
  if (typeof payload !== "object" || payload === null) return [];
  const issues = (payload as { params?: { issues?: unknown } }).params?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null) return [];
    const { path, code } = issue as { path?: unknown; code?: unknown };
    return typeof path === "string" && typeof code === "string" ? [{ path, code }] : [];
  });
}

export async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, code: problemCode(payload), issues: readIssues(payload) };
}

export const jsonHeaders = { "content-type": "application/json" };

export function moment(value: string | null, locale: string, fallback: string): string {
  return value ? new Date(value).toLocaleString(locale) : fallback;
}

/** `enabled` becomes `statusEnabled` and `healthEnabled`: one derivation, no table to keep in step. */
export function stateLabel(t: Labels, prefix: "status" | "health", state: string): string {
  return t[`${prefix}${state.charAt(0).toUpperCase()}${state.slice(1)}`] ?? state;
}

export const runTone: Record<ConnectorRun["status"], StatusTone> = {
  running: "active",
  succeeded: "done",
  failed: "danger",
  dead_letter: "closed"
};

export const runLabel: Record<ConnectorRun["status"], string> = {
  running: "runRunning",
  succeeded: "runSucceeded",
  failed: "runFailed",
  dead_letter: "runDeadLetter"
};

export const fieldName = (name: string) => `config.${name}`;

/** Reads a connector's fields out of a submitted form, as `configFromForm` wants them. */
export const configReader =
  (data: FormData): FormReader =>
  (name) => {
    const value = data.get(fieldName(name));
    return typeof value === "string" ? value : null;
  };

const inputType: Record<ConnectorConfigField["kind"], string> = {
  url: "url",
  text: "text",
  number: "number",
  toggle: "checkbox",
  list: "text"
};

/**
 * The form a connector asked for.
 *
 * Which fields exist, and which of them may be left blank, are the connector's own answers,
 * carried by the catalogue — so this draws a form for a provider it has never heard of, and a
 * connector added in a later release needs no change here. What it does own is the mapping from a
 * declared kind to a control, and putting a rejected value's complaint on the field it belongs to
 * instead of in a list underneath.
 *
 * `version` remounts the inputs after a save: they are uncontrolled, so without it the browser
 * would keep showing what was typed rather than what the server stored.
 */
export function ConfigFields({
  type,
  fields,
  config,
  issues,
  busy,
  version,
  labels: t
}: {
  type: string;
  fields: readonly ConnectorConfigField[];
  config: Record<string, unknown>;
  issues: ConfigIssue[];
  busy: boolean;
  version: string;
  labels: Labels;
}) {
  return (
    <>
      {fields.map((field) => {
        const key = `${version}:${field.name}`;
        const label = fieldLabel(t, type, field.name);
        const hint = fieldHint(t, type, field.name);
        const issue = issues.find((candidate) => candidate.path === field.name);

        if (field.kind === "toggle") {
          return (
            <ToggleField
              key={key}
              label={label}
              name={fieldName(field.name)}
              defaultChecked={isChecked(field, config)}
              disabled={busy}
              {...(hint ? { hint } : {})}
            />
          );
        }

        return (
          <TextField
            key={key}
            label={label}
            name={fieldName(field.name)}
            type={inputType[field.kind]}
            required={field.required}
            disabled={busy}
            defaultValue={fieldValue(field, config)}
            spellCheck={false}
            wide={field.kind === "list"}
            {...(hint ? { hint } : {})}
            {...(issue ? { error: issueMessage(t, issue.code) } : {})}
          />
        );
      })}
    </>
  );
}

/**
 * A connector's whole configuration, in the two halves it comes in.
 *
 * What it takes to reach the provider is asked outright; how much to read once reached is folded
 * away, because every one of those fields already answers for itself and a form that opens with
 * five questions nobody has to answer reads as five questions somebody has to research. The
 * disclosure is a plain `<details>`: it opens with the keyboard, it prints open, and it is one
 * element rather than a widget with its own idea of what focus means.
 */
export function ConfigForm({
  type,
  fields,
  config,
  issues,
  busy,
  version,
  labels: t
}: {
  type: string;
  fields: readonly ConnectorConfigField[];
  config: Record<string, unknown>;
  issues: ConfigIssue[];
  busy: boolean;
  version: string;
  labels: Labels;
}) {
  const connection = fields.filter((field) => field.group === "connection");
  const behaviour = fields.filter((field) => field.group === "behaviour");
  // A complaint about a folded-away field would otherwise be invisible, so the disclosure opens
  // itself rather than hiding the reason a submit was refused.
  const refused = behaviour.some((field) => issues.some((issue) => issue.path === field.name));

  return (
    <>
      <ConfigFields
        type={type}
        fields={connection}
        config={config}
        issues={issues}
        busy={busy}
        version={version}
        labels={t}
      />
      {/* Spread rather than `open={refused}`: a literal `false` makes React own the attribute and
          slam the disclosure shut on the next render, throwing away the operator's own click. */}
      {behaviour.length > 0 && (
        <details className="config-advanced wide" {...(refused ? { open: true } : {})}>
          <summary>{t.advancedOptions}</summary>
          <div className="config-advanced-fields">
            <ConfigFields
              type={type}
              fields={behaviour}
              config={config}
              issues={issues}
              busy={busy}
              version={version}
              labels={t}
            />
          </div>
        </details>
      )}
    </>
  );
}

/**
 * The complaints no field claimed.
 *
 * A path that names a declared field is shown on that field, so what reaches here is what has
 * nowhere better to go: a rejection of the configuration as a whole, or a key the connector no
 * longer declares. Rendered as path and code, untranslated, because that is a developer's problem
 * and dressing it up as a sentence would only make it harder to search for.
 */
export function ConfigIssues({ issues, fields }: { issues: ConfigIssue[]; fields: readonly ConnectorConfigField[] }) {
  const named = new Set(fields.map((field) => field.name));
  const orphans = issues.filter((issue) => !named.has(issue.path));
  if (orphans.length === 0) return null;
  return (
    <ul className="integration-issues wide">
      {orphans.map((issue) => (
        <li key={`${issue.path}:${issue.code}`}>
          <code>{issue.path || "/"}</code> {issue.code}
        </li>
      ))}
    </ul>
  );
}

/**
 * Writing a credential.
 *
 * The one direction this API has. A secret is written and never read back — no route returns one,
 * so the panel above this form can only ever list metadata — and the value does not survive the
 * submit either: it is read out of the form, sent, and the form is reset. Nothing here keeps it in

 *
 * Writing a second value for a kind that already has one opens a rotation rather than replacing
 * anything, which is what makes a key change survivable: both are accepted until the new one is
 * promoted. The hint says so, because a form that quietly did something different from what the
 * operator expected is how a rotation gets left half done.
 */
export function CredentialForm({
  instanceId,
  type,
  kinds,
  labels: t
}: {
  instanceId: string;
  type: string;
  kinds: readonly string[];
  labels: Labels;
}) {
  const [kind, setKind] = useState(kinds[0] ?? "");
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function write(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Captured before the await: after it, React has already pointed `currentTarget` at nothing.
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = formValue(data, "kind");
    setBusy(true);
    const result = await request<unknown>(
      `/api/v1/integrations/${instanceId}/credentials/${encodeURIComponent(kind)}`,
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ secret: formValue(data, "secret") }) }
    );
    setBusy(false);
    if (!result.ok) return toast("error", errorMessage(t, result.code));
    form.reset();
    toast("success", t.credentialWritten ?? "");
    router.refresh();
  }

  return (
    <form className="dialog-form" onSubmit={eventHandler(write, () => setBusy(false))}>
      {kinds.length > 1 ? (
        <SelectField
          label={t.credentialKind!}
          name="kind"
          required
          disabled={busy}
          value={kind}
          onChange={(event) => setKind(event.currentTarget.value)}
          options={kinds.map((option) => ({ value: option, label: credentialKindLabel(t, option) }))}
        />
      ) : (
        <input type="hidden" name="kind" value={kind} />
      )}
      {/* Where this particular secret comes from, which is the one thing the operator has to go
          and find. The kind drives it, so switching kinds switches the instructions. */}
      <TextField
        label={t.credentialSecret!}
        name="secret"
        type="password"
        required
        minLength={8}
        maxLength={8192}
        disabled={busy}
        wide
        autoComplete="off"
        spellCheck={false}
        hint={[credentialKindHint(t, type, kind), t.credentialSecretHint].filter(Boolean).join(" ")}
      />
      <button className="primary-button" disabled={busy}>
        <KeyRound size={16} aria-hidden="true" />
        {t.credentialWrite}
      </button>
    </form>
  );
}

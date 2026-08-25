"use client";

import { getMcpDictionary, mcpErrorMessage, mcpScopeLabel, type Locale } from "@control-hub/i18n";
import { Ban, Bot, Eye, KeyRound, Plug, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SelectControl } from "@/components/form-field";
import type {
  McpClientRow,
  McpClientsResponse,
  McpGrantRow,
  McpGrantsResponse,
  McpServiceAccountRow,
  McpServiceAccountsResponse
} from "@/lib/api-types";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";
import { agentsSection, redirectUriLines } from "@/lib/mcp-agents";

/** Which of the three panels an answer belongs to, so a refusal is read where it was caused. */
type Panel = "clients" | "grants" | "accounts";

/**
 * The agents half of the security screen: who may ask, what has been consented to, and which
 * accounts hold a key.
 *
 * Whether this section exists at all is the API's answer and not a rule kept here. The first
 * listing decides it: a 404 means the surface is not mounted on this installation, a 403 means
 * this reader may not administer it, and either way the section draws nothing. Deciding it here
 * would mean a second copy of the condition -- and the feature flag is read from the environment,
 * which a `"use client"` component cannot see in the first place.
 *
 * The two vocabularies the forms offer also come from the API. They are closed lists in the
 * domain, which this application does not depend on, and a copy kept here would go stale in the
 * quietest way there is: by offering fewer choices than exist, with nothing failing.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */
export function McpAgents({ locale }: { locale: Locale }) {
  const t = getMcpDictionary(locale);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [clients, setClients] = useState<McpClientRow[]>([]);
  const [registrableScopes, setRegistrableScopes] = useState<string[]>([]);
  const [grants, setGrants] = useState<McpGrantRow[]>([]);
  const [accounts, setAccounts] = useState<McpServiceAccountRow[]>([]);
  const [grantableScopes, setGrantableScopes] = useState<string[]>([]);
  const [error, setError] = useState<{ panel: Panel; message: string } | null>(null);
  // Shown once and never fetched again: the store keeps a hash, so this is the only moment the
  // value exists anywhere a person can read it.
  const [secret, setSecret] = useState<{ panel: Panel; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/v1/mcp/clients");
      const section = agentsSection(response.status);
      if (section === "hidden") return setAvailable(false);
      setAvailable(true);
      if (section === "failed") return setError({ panel: "clients", message: t.loadFailed });
      const payload = (await response.json()) as McpClientsResponse;
      setClients(payload.clients);
      setRegistrableScopes(payload.scopes);

      const [grantsResponse, accountsResponse] = await Promise.all([
        fetch("/api/v1/mcp/grants"),
        fetch("/api/v1/mcp/service-accounts")
      ]);
      if (grantsResponse.ok) setGrants(((await grantsResponse.json()) as McpGrantsResponse).grants);
      if (accountsResponse.ok) {
        const accountsPayload = (await accountsResponse.json()) as McpServiceAccountsResponse;
        setAccounts(accountsPayload.serviceAccounts);
        setGrantableScopes(accountsPayload.grantableScopes);
      }
    })().catch(() => setAvailable(false));
  }, [t.loadFailed]);

  /** Reads a refusal the way this surface answers one: problem details carrying a code. */
  async function fail(panel: Panel, response: Response) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string };
    setError({ panel, message: mcpErrorMessage(locale, payload.code) });
  }

  const chosenScopes = (data: FormData) =>
    data.getAll("scopes").filter((value): value is string => typeof value === "string");

  async function registerClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSecret(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const response = await fetch("/api/v1/mcp/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formValue(data, "name"),
        kind: formValue(data, "kind"),
        redirectUris: redirectUriLines(formValue(data, "redirectUris")),
        maxScopes: chosenScopes(data)
      })
    });
    setBusy(false);
    if (!response.ok) return fail("clients", response);
    const payload = (await response.json()) as { client: McpClientRow; secret: string | null };
    setClients((current) => [payload.client, ...current]);
    if (payload.secret !== null) setSecret({ panel: "clients", value: payload.secret });
    form.reset();
  }

  async function deleteClient(id: string) {
    const response = await fetch(`/api/v1/mcp/clients/${id}`, { method: "DELETE" });
    if (!response.ok) return fail("clients", response);
    setClients((current) => current.filter((item) => item.id !== id));
  }

  async function revokeGrant(id: string) {
    const response = await fetch(`/api/v1/mcp/grants/${id}`, { method: "DELETE" });
    if (!response.ok) return fail("grants", response);
    setGrants((current) => current.filter((item) => item.id !== id));
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSecret(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const response = await fetch("/api/v1/mcp/service-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No permissions named: the scopes decide them, and the API caps the result at what this
      // person already holds. Naming them here would put a copy of that mapping in the browser.
      body: JSON.stringify({ name: formValue(data, "name"), scopes: chosenScopes(data), permissions: [] })
    });
    setBusy(false);
    if (!response.ok) return fail("accounts", response);
    const payload = (await response.json()) as { serviceAccount: McpServiceAccountRow; secret: string };
    setAccounts((current) => [payload.serviceAccount, ...current]);
    setSecret({ panel: "accounts", value: payload.secret });
    form.reset();
  }

  async function rotate(id: string) {
    setError(null);
    setSecret(null);
    const response = await fetch(`/api/v1/mcp/service-accounts/${id}/rotate`, { method: "POST" });
    if (!response.ok) return fail("accounts", response);
    const payload = (await response.json()) as { secret: string };
    setSecret({ panel: "accounts", value: payload.secret });
    // The previous secret keeps working until it is retired, so the row records that a rotation
    // happened rather than implying the old one is already dead.
    setAccounts((current) =>
      current.map((item) => (item.id === id ? { ...item, secretRotatedAt: new Date().toISOString() } : item))
    );
  }

  async function retirePrevious(id: string) {
    const response = await fetch(`/api/v1/mcp/service-accounts/${id}/retire-previous-secret`, { method: "POST" });
    if (!response.ok) return fail("accounts", response);
    setAccounts((current) => current.map((item) => (item.id === id ? { ...item, secretRotatedAt: null } : item)));
  }

  async function disableAccount(id: string) {
    const response = await fetch(`/api/v1/mcp/service-accounts/${id}`, { method: "DELETE" });
    if (!response.ok) return fail("accounts", response);
    setAccounts((current) =>
      current.map((item) => (item.id === id ? { ...item, disabledAt: new Date().toISOString() } : item))
    );
  }

  const statusLabel = (status: string) =>
    status === "revoked"
      ? t.statusRevoked
      : status === "expired"
        ? t.statusExpired
        : status === "suspended"
          ? t.statusSuspended
          : t.statusActive;

  const day = (value: string) => new Date(value).toLocaleDateString(locale);

  const scopeChoices = (hint: string, scopes: readonly string[]) => (
    <fieldset className="agent-scopes">
      <legend>{t.agentScopes}</legend>
      <div>
        {scopes.map((scope) => (
          <label key={scope}>
            <input type="checkbox" name="scopes" value={scope} />
            {mcpScopeLabel(locale, scope)}
          </label>
        ))}
      </div>
      <small>{hint}</small>
    </fieldset>
  );

  /**
   * A refusal is shown in the panel that caused it, and a secret in the panel that minted it.
   * One shared slot would put the answer to "delete this consent" under a form somebody is still
   * filling in, and a secret under the wrong heading is a secret somebody misfiles.
   */
  const feedback = (panel: Panel): ReactNode => (
    <>
      {error?.panel === panel && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      {secret?.panel === panel && (
        <div className="secret-output">
          <strong>{t.secretTitle}</strong>
          <p>{t.secretWarning}</p>
          <code>{secret.value}</code>
        </div>
      )}
    </>
  );

  if (available !== true) return null;

  return (
    <>
      <article className="security-panel agents-panel">
        <Bot size={24} />
        <h2>{t.agentsTitle}</h2>
        <p>{t.agentsDescription}</p>
        <form
          className="agent-form"
          onSubmit={eventHandler(registerClient, () => setError({ panel: "clients", message: t.loadFailed }))}
        >
          <label>
            {t.agentName}
            <input name="name" required maxLength={120} />
            <small>{t.agentNameHint}</small>
          </label>
          <label>
            {t.agentKind}
            <SelectControl
              name="kind"
              defaultValue="public"
              options={[
                { value: "public", label: t.agentKindPublicOption },
                { value: "confidential", label: t.agentKindConfidentialOption }
              ]}
            />
          </label>
          <label className="agent-wide">
            {t.agentRedirects}
            <textarea name="redirectUris" rows={3} required />
            <small>{t.agentRedirectsHint}</small>
          </label>
          {scopeChoices(t.agentScopesHint, registrableScopes)}
          <button className="primary-button" disabled={busy}>
            {t.register}
          </button>
        </form>
        {feedback("clients")}
        <div className="invitation-list">
          {clients.length === 0 && <p className="crm-empty">{t.agentsEmpty}</p>}
          {clients.map((item) => (
            <div className="invitation-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {t.agentClientId}: <code>{item.clientId}</code> · {statusLabel(item.status)}
                </small>
                <small>
                  {t.agentRedirects}: {item.redirectUris.join(" · ")}
                </small>
                <small>
                  {t.agentScopes}: {item.maxScopes.map((scope) => mcpScopeLabel(locale, scope)).join(" · ")}
                </small>
              </div>
              <button
                className="icon-button"
                title={t.deleteAgent}
                aria-label={t.deleteAgent}
                onClick={actionHandler(
                  () => deleteClient(item.id),
                  () => setError({ panel: "clients", message: t.loadFailed })
                )}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </article>

      <article className="security-panel agents-panel">
        <Plug size={24} />
        <h2>{t.consentsTitle}</h2>
        <p>{t.consentsDescription}</p>
        {feedback("grants")}
        <div className="invitation-list">
          {grants.length === 0 && <p className="crm-empty">{t.consentsEmpty}</p>}
          {grants.map((item) => (
            <div className="invitation-row" key={item.id}>
              <div>
                <strong>{item.clientName ?? t.consentActorService}</strong>
                <small>
                  {item.actorType === "user" ? t.consentActorUser : t.consentActorService} · {statusLabel(item.status)}{" "}
                  · {t.consentExpires} {day(item.expiresAt)}
                </small>
                <small className="agent-scope-line">
                  <Eye size={13} /> {item.scopes.map((scope) => mcpScopeLabel(locale, scope)).join(" · ")}
                </small>
                <small>
                  {item.lastUsedAt === null ? t.consentNeverUsed : `${t.consentLastUsed} ${day(item.lastUsedAt)}`}
                </small>
              </div>
              <button
                className="icon-button"
                title={t.revokeConsent}
                aria-label={t.revokeConsent}
                onClick={actionHandler(
                  () => revokeGrant(item.id),
                  () => setError({ panel: "grants", message: t.loadFailed })
                )}
              >
                <Ban size={16} />
              </button>
            </div>
          ))}
        </div>
      </article>

      <article className="security-panel agents-panel">
        <KeyRound size={24} />
        <h2>{t.accountsTitle}</h2>
        <p>{t.accountsDescription}</p>
        <form
          className="agent-form"
          onSubmit={eventHandler(createAccount, () => setError({ panel: "accounts", message: t.loadFailed }))}
        >
          <label>
            {t.accountName}
            <input name="name" required maxLength={120} />
          </label>
          {scopeChoices(t.accountScopesHint, grantableScopes)}
          <button className="primary-button" disabled={busy}>
            {t.createAccount}
          </button>
        </form>
        {feedback("accounts")}
        <div className="invitation-list">
          {accounts.length === 0 && <p className="crm-empty">{t.accountsEmpty}</p>}
          {accounts.map((item) => (
            <div className="invitation-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small className="agent-scope-line">
                  <Eye size={13} /> {item.scopes.map((scope) => mcpScopeLabel(locale, scope)).join(" · ")}
                </small>
                <small>
                  {t.accountExpires} {day(item.expiresAt)}
                  {item.secretRotatedAt !== null && ` · ${t.accountRotated} ${day(item.secretRotatedAt)}`}
                  {item.disabledAt !== null && ` · ${t.accountDisabled}`}
                </small>
              </div>
              <div className="agent-actions">
                {item.secretRotatedAt !== null && (
                  <button
                    className="secondary-button"
                    onClick={actionHandler(
                      () => retirePrevious(item.id),
                      () => setError({ panel: "accounts", message: t.loadFailed })
                    )}
                  >
                    {t.retirePreviousSecret}
                  </button>
                )}
                <button
                  className="icon-button"
                  title={t.rotateSecret}
                  aria-label={t.rotateSecret}
                  onClick={actionHandler(
                    () => rotate(item.id),
                    () => setError({ panel: "accounts", message: t.loadFailed })
                  )}
                >
                  <RotateCw size={16} />
                </button>
                <button
                  className="icon-button"
                  title={t.disableAccount}
                  aria-label={t.disableAccount}
                  disabled={item.disabledAt !== null}
                  onClick={actionHandler(
                    () => disableAccount(item.id),
                    () => setError({ panel: "accounts", message: t.loadFailed })
                  )}
                >
                  <Ban size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </>
  );
}

"use client";

import { getMcpDictionary, type Locale } from "@control-hub/i18n";
import { Check, Copy, Info, Link2 } from "lucide-react";
import { useState } from "react";
import { SelectControl } from "@/components/form-field";
import type { McpClientRow } from "@/lib/api-types";
import { connectionRecipes } from "@/lib/mcp-connection";

/**
 * How to point an assistant at this server.
 *
 * The address is the API's own `resource`, taken from the service that mints the tokens rather
 * than composed here: an address assembled on a screen can differ from the audience a token is
 * checked against, and the mismatch surfaces much later, inside somebody else's client, reading
 * like a bug in the server.
 *
 * The notice about registration is not a caveat added for completeness. Assistants obtain their
 * identifier by registering themselves through RFC 7591, so nothing here has one to show until a
 * connection has been authorized -- and a panel that offered a field for it would be inviting
 * somebody to paste a value the assistant has nowhere to put. The selector below is for the other
 * case: clients that do ask a person for an identifier, which take one from an agent already here.
 */
export function McpConnection({
  locale,
  resource,
  clients
}: {
  locale: Locale;
  resource: string;
  clients: McpClientRow[];
}) {
  const t = getMcpDictionary(locale);
  const [clientId, setClientId] = useState("");
  const [copied, setCopied] = useState("");

  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? "" : current)), 2000);
    });
  }

  const copyButton = (key: string, value: string) => (
    <button className="icon-button" type="button" title={t.copy} aria-label={t.copy} onClick={() => copy(key, value)}>
      {copied === key ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );

  const address = (label: string, value: string, key: string) => (
    <div className="connect-address">
      <div>
        <span>{label}</span>
        <code>{value}</code>
      </div>
      {copyButton(key, value)}
    </div>
  );

  return (
    <article className="security-panel agents-panel">
      <Link2 size={24} />
      <h2>{t.connectTitle}</h2>
      <p>{t.connectDescription}</p>

      {address(t.connectUrl, resource, "resource")}

      {clients.length > 0 && (
        <label className="connect-pick">
          {t.connectPickAgent}
          <SelectControl
            name="clientId"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder={t.connectPickHint}
            options={clients.map((client) => ({ value: client.clientId, label: client.name }))}
          />
        </label>
      )}
      {clientId !== "" && address(t.agentClientId, clientId, "clientId")}

      <p className="connect-notice">
        <Info size={16} />
        {t.connectRegistrationNotice}
      </p>

      <div className="connect-recipes">
        {connectionRecipes(resource).map((recipe) => (
          <section key={recipe.key}>
            <h3>{t[recipe.key]}</h3>
            <p>{t[recipe.hint]}</p>
            <div className="connect-snippet">
              <pre>
                <code>{recipe.snippet}</code>
              </pre>
              {copyButton(recipe.key, recipe.snippet)}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

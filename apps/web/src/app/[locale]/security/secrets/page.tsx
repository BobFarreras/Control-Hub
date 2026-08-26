"use client";

import { getDictionary, getSecretsDictionary, isLocale } from "@control-hub/i18n";
import { CircleAlert, Database, KeyRound, LockKeyhole, Package, ServerCog } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import type { InstallationResponse, SecretMetadataResponse } from "@/lib/api-types";

const healthTone = {
  available: "tone-active",
  warning: "tone-warning",
  not_observed: "tone-neutral",
  not_applicable: "tone-neutral"
} as const;

export default function SecretsPage() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const common = getDictionary(locale);
  const t = getSecretsDictionary(locale);
  const [snapshot, setSnapshot] = useState<SecretMetadataResponse | null>(null);
  const [installation, setInstallation] = useState<InstallationResponse | null>(null);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/settings/secrets", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) return setError("forbidden");
        if (!response.ok) return setError("failed");
        setSnapshot((await response.json()) as SecretMetadataResponse);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("failed");
      });
    // Separate from the snapshot, and quiet when it fails. An Administrator is allowed to read
    // this and not the secrets, so one request answering 403 says nothing about the other -- and
    // failing to name the version is not worth an error banner over a page about something else.
    void fetch("/api/v1/settings/installation", { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) setInstallation((await response.json()) as InstallationResponse);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const healthLabel = (health: SecretMetadataResponse["provider"]["health"]) => t[`health_${health}`];

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={common.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
          themeLabel={common.header.theme}
          back={{ label: common.header.back, fallbackHref: `/${locale}/security` }}
        />
        <main className="secrets-settings-page">
          {error && (
            <section className="secrets-notice" role="alert">
              <CircleAlert size={20} />
              <span>{error === "forbidden" ? t.ownerOnly : t.loadError}</span>
            </section>
          )}
          {installation && (
            <section className="secrets-provider-panel" aria-labelledby="secrets-installation-title">
              <div className="secrets-provider-icon">
                <Package size={24} />
              </div>
              <div>
                <span>{t.installation}</span>
                <h2 id="secrets-installation-title">
                  {t.installedVersion} {installation.version}
                </h2>
                <p>
                  {t.buildIdentifier}:{" "}
                  {installation.build === "development" ? t.buildDevelopment : <code>{installation.build}</code>}
                </p>
              </div>
            </section>
          )}
          {snapshot && (
            <>
              <section className="secrets-provider-panel" aria-labelledby="secrets-provider-title">
                <div className="secrets-provider-icon">
                  <ServerCog size={24} />
                </div>
                <div>
                  <span>{t.provider}</span>
                  <h2 id="secrets-provider-title">{t[`provider_${snapshot.provider.kind}`]}</h2>
                  <p>
                    {snapshot.provider.kind === "bitwarden"
                      ? t.externalHint
                      : snapshot.provider.kind === "environment"
                        ? t.environmentHint
                        : t.inventoryDescription}
                  </p>
                </div>
                <span className={`status-pill ${healthTone[snapshot.provider.health]}`}>
                  {healthLabel(snapshot.provider.health)}
                </span>
              </section>

              <section className="secrets-inventory" aria-labelledby="secrets-inventory-title">
                <header>
                  <div>
                    <span>{t.inventory}</span>
                    <h2 id="secrets-inventory-title">{snapshot.secrets.length}</h2>
                  </div>
                  <p>{t.inventoryDescription}</p>
                </header>
                <div className="secrets-card-grid">
                  {snapshot.secrets.map((secret) => {
                    const Icon =
                      secret.name === "DATABASE_URL"
                        ? Database
                        : secret.name.includes("KEY_RING")
                          ? LockKeyhole
                          : KeyRound;
                    const configured =
                      secret.configured === null ? t.unknown : secret.configured ? t.configured : t.notConfigured;
                    return (
                      <article className="secret-metadata-card" key={secret.name}>
                        <div className="secret-metadata-heading">
                          <span className="secret-metadata-icon">
                            <Icon size={19} />
                          </span>
                          <div>
                            <code>{secret.name}</code>
                            <strong>{configured}</strong>
                          </div>
                          <span className={`status-pill ${healthTone[secret.health]}`}>
                            {healthLabel(secret.health)}
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>{t.source}</dt>
                            <dd>{t[`source_${secret.source}`]}</dd>
                          </div>
                          <div>
                            <dt>{t.consumers}</dt>
                            <dd>{secret.consumers.join(" · ")}</dd>
                          </div>
                          <div>
                            <dt>{t.loaded}</dt>
                            <dd>{secret.loadedAt ? new Date(secret.loadedAt).toLocaleString(locale) : t.never}</dd>
                          </div>
                          <div>
                            <dt>{t.rotated}</dt>
                            <dd>
                              {secret.lastRotatedAt ? new Date(secret.lastRotatedAt).toLocaleString(locale) : t.never}
                            </dd>
                          </div>
                          <div>
                            <dt>{t.version}</dt>
                            <dd>{secret.version ?? t.noVersion}</dd>
                          </div>
                        </dl>
                        {secret.name === "SMTP_PASSWORD" && <p className="secret-card-note">{t.smtpHint}</p>}
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import { getDictionary, isLocale } from "@control-hub/i18n";
import { KeyRound, Laptop, LogOut, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SelectControl } from "@/components/form-field";
import { PageTopbar } from "@/components/page-topbar";
import { authClient } from "@/lib/auth-client";
import { formValue } from "@/lib/form";
import { actionHandler, eventHandler } from "@/lib/handlers";

type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; expiresAt: Date };
type Invitation = { id: string; email: string; role: "administrator" | "technical"; expiresAt: string };

export default function SecurityPage() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getDictionary(locale);
  const router = useRouter();
  const session = authClient.useSession();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [totpUri, setTotpUri] = useState("");
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[]>([]);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [canManageMembers, setCanManageMembers] = useState(false);
  const mfaEnabled = Boolean(session.data?.user.twoFactorEnabled);

  useEffect(() => {
    void authClient.listSessions().then((result) => {
      if (result.data) setSessions(result.data as Session[]);
    });
    void fetch("/api/v1/me").then(async (response) => {
      if (response.ok) {
        const payload = (await response.json()) as { context: { permissions: string[]; mfaEnabled: boolean } };
        setCanManageMembers(payload.context.permissions.includes("members:manage") && payload.context.mfaEnabled);
      }
    });
    void fetch("/api/v1/invitations").then(async (response) => {
      if (response.ok) setInvitations(((await response.json()) as { invitations: Invitation[] }).invitations);
    });
  }, []);

  async function enableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBackupCodes([]);
    const result = await authClient.twoFactor.enable({
      password: formValue(new FormData(event.currentTarget), "password")
    });
    if (result.error) return setError(result.error.message ?? "TOTP");
    setTotpUri(result.data.totpURI);
    setPendingBackupCodes(result.data.backupCodes);
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const code = formValue(new FormData(event.currentTarget), "code").replace(/\s/g, "");
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (result.error) return setError(result.error.message ?? "TOTP");
    setBackupCodes(pendingBackupCodes);
    setPendingBackupCodes([]);
    setTotpUri("");
    await session.refetch();
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvitationError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/v1/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), role: data.get("role"), locale })
    });
    const payload = (await response.json().catch(() => ({}))) as { invitation?: Invitation; code?: string };
    if (!response.ok || !payload.invitation) return setInvitationError(payload.code ?? t.invitations.error);
    setInvitations((current) => [payload.invitation!, ...current]);
    form.reset();
  }

  async function revokeInvitation(id: string) {
    const response = await fetch(`/api/v1/invitations/${id}`, { method: "DELETE" });
    if (response.ok) setInvitations((current) => current.filter((item) => item.id !== id));
  }
  async function signOut() {
    await authClient.signOut();
    router.replace(`/${locale}/login`);
  }
  async function revoke(token: string) {
    const result = await authClient.revokeSession({ token });
    if (!result.error) setSessions((current) => current.filter((item) => item.token !== token));
  }
  async function addPasskey() {
    const result = await authClient.passkey.addPasskey({ name: "Control Hub" });
    if (result.error) setError(result.error.message ?? "WebAuthn");
  }

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow="CONTROL HUB"
          title={t.security.title}
          description={session.data?.user.email}
          themeLabel={t.header.theme}
          actions={
            <button className="secondary-button" onClick={actionHandler(signOut, () => setError("OPERATION_FAILED"))}>
              <LogOut size={17} />
              {t.security.signOut}
            </button>
          }
        />
        <main className="security-page">
          <section className="security-grid">
            <article className="security-panel">
              <ShieldCheck size={24} />
              <h2>{t.security.secondFactor}</h2>
              <p>{t.security.mfaDescription}</p>
              {!mfaEnabled && !totpUri && backupCodes.length === 0 && (
                <form
                  className="auth-form compact"
                  onSubmit={eventHandler(enableTotp, () => setError("OPERATION_FAILED"))}
                >
                  <label>
                    {t.security.currentPassword}
                    <input name="password" type="password" autoComplete="current-password" required />
                  </label>
                  <button className="primary-button">{t.security.enableTotp}</button>
                </form>
              )}
              {mfaEnabled && backupCodes.length === 0 && <p className="security-success">{t.security.totpEnabled}</p>}
              <button
                className="secondary-button"
                type="button"
                onClick={actionHandler(addPasskey, () => setError("OPERATION_FAILED"))}
              >
                {t.security.addPasskey}
              </button>
              {totpUri && (
                <div className="totp-enrollment">
                  <div className="qr-surface">
                    <QRCodeSVG value={totpUri} size={192} level="M" />
                  </div>
                  <p>{t.security.scanQr}</p>
                  <form
                    className="auth-form compact"
                    onSubmit={eventHandler(verifyTotp, () => setError("OPERATION_FAILED"))}
                  >
                    <label>
                      {t.security.verificationCode}
                      <input
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        minLength={6}
                        maxLength={6}
                        required
                      />
                    </label>
                    <button className="primary-button">{t.security.confirmTotp}</button>
                  </form>
                </div>
              )}
              {error && <p className="form-error">{error}</p>}
              {backupCodes.length > 0 && (
                <div className="secret-output">
                  <strong>{t.security.backupCodes}</strong>
                  <p>{t.security.backupWarning}</p>
                  <code>{backupCodes.join("\n")}</code>
                </div>
              )}
            </article>
            <article className="security-panel">
              <Laptop size={24} />
              <h2>{t.security.sessions}</h2>
              <div className="session-list">
                {sessions.map((item) => (
                  <div className="session-row" key={item.id}>
                    <KeyRound size={17} />
                    <div>
                      <strong>{item.userAgent ?? t.security.unknownDevice}</strong>
                      <small>{item.ipAddress ?? t.security.unknownIp}</small>
                    </div>
                    <time>{new Date(item.expiresAt).toLocaleDateString(locale)}</time>
                    <button
                      className="icon-button"
                      title={t.security.revoke}
                      aria-label={t.security.revoke}
                      onClick={actionHandler(
                        () => revoke(item.token),
                        () => setError("OPERATION_FAILED")
                      )}
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
            {canManageMembers && (
              <article className="security-panel members-panel">
                <UserPlus size={24} />
                <h2>{t.invitations.title}</h2>
                <p>{t.invitations.description}</p>
                <form
                  className="invite-form"
                  onSubmit={eventHandler(inviteMember, () => setInvitationError(t.invitations.error))}
                >
                  <label>
                    {t.auth.email}
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    {t.invitations.role}
                    <SelectControl
                      name="role"
                      defaultValue="technical"
                      options={[
                        { value: "technical", label: t.invitations.technical },
                        { value: "administrator", label: t.invitations.administrator }
                      ]}
                    />
                  </label>
                  <button className="primary-button">{t.invitations.send}</button>
                </form>
                {invitationError && <p className="form-error">{invitationError}</p>}
                <div className="invitation-list">
                  {invitations.map((item) => (
                    <div className="invitation-row" key={item.id}>
                      <div>
                        <strong>{item.email}</strong>
                        <small>
                          {item.role === "administrator" ? t.invitations.administrator : t.invitations.technical} ·{" "}
                          {new Date(item.expiresAt).toLocaleString(locale)}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        title={t.invitations.revoke}
                        aria-label={t.invitations.revoke}
                        onClick={actionHandler(
                          () => revokeInvitation(item.id),
                          () => setInvitationError(t.invitations.error)
                        )}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

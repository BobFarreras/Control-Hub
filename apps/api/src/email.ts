import type { ApiEnvironment } from "@control-hub/config";
import nodemailer from "nodemailer";

export type MailConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string | undefined;
  password?: string | undefined;
};
export type MailSender = ReturnType<typeof createMailSender>;

/**
 * The transport, as data, so the decision that matters can be asserted without a relay.
 *
 * Whether `auth` is present decides whether this installation can send mail at all: every
 * transactional provider refuses an unauthenticated session, and the first message that fails is
 * the link the first Owner needs to reach their own account. It is one ternary, and it is the
 * whole reason `SMTP_USER` exists.
 */
export function mailTransportOptions(configuration: MailConfiguration) {
  return {
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(configuration.user && configuration.password
      ? { auth: { user: configuration.user, pass: configuration.password } }
      : {})
  };
}

/**
 * The relay settings a process was started with, read in one place so two call sites cannot drift.
 *
 * `Pick` rather than the whole environment: this module has no business seeing a database URL, and
 * naming the six fields means adding a seventh is a compile error here rather than a setting that
 * silently never reaches the transport.
 */
export function mailConfiguration(
  environment: Pick<
    ApiEnvironment,
    "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_FROM" | "SMTP_USER" | "SMTP_PASSWORD"
  >
): MailConfiguration {
  return {
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
    from: environment.SMTP_FROM,
    user: environment.SMTP_USER,
    password: environment.SMTP_PASSWORD
  };
}

export function createMailSender(configuration: MailConfiguration) {
  const transport = nodemailer.createTransport(mailTransportOptions(configuration));
  return async (message: { to: string; subject: string; text: string }) => {
    await transport.sendMail({ from: configuration.from, ...message });
  };
}

import { passkey } from "@better-auth/passkey";
import type { ApiEnvironment } from "@control-hub/config";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
import { createMailSender } from "./email.js";

export function createAuth(environment: ApiEnvironment, options: { allowSignUp?: boolean } = {}) {
  const sendMail = createMailSender({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
    from: environment.SMTP_FROM
  });
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 10 });

  const auth = betterAuth({
    appName: "Control Hub",
    baseURL: environment.APP_ORIGIN,
    basePath: "/api/auth",
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [environment.APP_ORIGIN],
    database: pool,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 900,
      // Awaited on purpose: discarding this promise hid delivery failures, so a password reset
      // that never left the building looked identical to one that arrived.
      sendResetPassword: async ({ user, url }) => {
        await sendMail({ to: user.email, subject: "Control Hub - Restablir contrasenya", text: url });
      }
    },
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({ to: user.email, subject: "Control Hub - Verificar correu", text: url });
      }
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60, freshAge: 60 * 10, preserveSessionInDatabase: true },
    advanced: { useSecureCookies: environment.NODE_ENV === "production", crossSubDomainCookies: { enabled: false } },
    plugins: [
      twoFactor({
        issuer: "Control Hub",
        backupCodeOptions: { amount: 10, length: 12 },
        totpOptions: { period: 30, digits: 6 }
      }),
      passkey({
        rpID: environment.WEBAUTHN_RP_ID,
        rpName: "Control Hub",
        origin: environment.WEBAUTHN_ORIGIN,
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" }
      })
    ]
  });
  return Object.assign(auth, { close: () => pool.end() });
}

export type ControlHubAuth = ReturnType<typeof createAuth>;

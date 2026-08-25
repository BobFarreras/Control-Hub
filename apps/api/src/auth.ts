import { passkey } from "@better-auth/passkey";
import type { ApiEnvironment } from "@control-hub/config";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
import { createMailSender } from "./email.js";

/**
 * How recently somebody must have proved who they are for a sensitive operation to be allowed.
 *
 * Exported rather than written twice: better-auth guards its own sensitive operations with this
 * number, and Control Hub guards consenting to an MCP client with it. Two copies would drift, and
 * the drift would show up as one of the two silently accepting a session the other refuses.
 */
export const sessionFreshAge = 60 * 10;

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
    /**
     * Thirty days, extended once a day while the panel is in use.
     *
     * It used to be twelve hours, and the eleven session rows in the development database all
     * had `updatedAt` equal to `createdAt`: not one was ever extended, so the panel logged its
     * only two users out twice a day at a fixed hour regardless of what they were doing.
     *
     * This is session lifetime, not factor policy. The second factor stays mandatory for every
     * account and is still demanded on a device that has not been trusted. `freshAge` is what
     * guards the sensitive operations, and it stays at ten minutes: changing a password or
     * touching the second factor asks again however old the session is.
     */
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: sessionFreshAge,
      preserveSessionInDatabase: true
    },
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

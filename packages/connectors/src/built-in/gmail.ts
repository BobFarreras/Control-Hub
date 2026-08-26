import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  type ConnectorContext,
  type HttpResponse
} from "../contract.js";

const api = "https://gmail.googleapis.com";
const gmailConfigSchema = z.strictObject({
  mailbox: z.literal("me").default("me"),
  baseUrl: z.literal(api).default(api),
  labelId: z.string().trim().min(1).max(128).default("INBOX")
});

type GmailConfig = z.infer<typeof gmailConfigSchema>;
type GmailMessage = {
  id?: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

const maxMessages = 50;
const sendMailSchema = z.strictObject({
  to: z.email().max(320),
  subject: z
    .string()
    .min(1)
    .max(500)
    .refine((value) => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(20_000)
});

export const gmail = defineConnector<GmailConfig>({
  type: "gmail",
  contractVersion: connectorContractVersion,
  configSchema: gmailConfigSchema,
  configFields: [
    { name: "mailbox", kind: "text", group: "connection" },
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "labelId", kind: "text", group: "behaviour" }
  ],
  credentialKinds: ["oauth_access_token", "oauth_refresh_token"],
  capabilities: {
    egress: { schemes: ["https"], destination: "configured_base_url" },
    operations: { pull_messages: { shape: "event", everySeconds: 300 } },
    actions: {
      send_mail: {
        permission: "tickets:manage",
        confirmation: "explicit",
        requiresMfa: true,
        reversible: false,
        retry: "before-delivery-only"
      }
    },
    ingress: false,
    oauth: {
      provider: "google",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revocationUrl: "https://oauth2.googleapis.com/revoke",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]
    }
  },
  async health(context) {
    const response = await request(context, `/gmail/v1/users/${context.config.mailbox}/profile`);
    return response.status === 200 ? { status: "ok" } : { status: "failed", failure: failure(response.status) };
  },
  operations: {
    async pull_messages(context, input) {
      const ids = input.cursor
        ? await historyIds(context, input.cursor, context.config.labelId)
        : await initialIds(context, context.config.labelId);
      const records = [];
      let cursor = input.cursor;
      for (const id of ids.slice(0, maxMessages)) {
        const response = await request(context, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
        if (response.status !== 200) throw new ConnectorError(`GMAIL_${failure(response.status).toUpperCase()}`);
        const message = parseJson<GmailMessage>(response);
        if (!message.id || !message.internalDate) throw new ConnectorError("GMAIL_RESPONSE_INVALID");
        cursor = maxDecimal(cursor, message.historyId ?? null);
        records.push({ externalId: message.id, data: normalize(message) });
      }
      if (!cursor) {
        const profile = await request(context, "/gmail/v1/users/me/profile");
        if (profile.status !== 200) throw new ConnectorError("GMAIL_RESPONSE_INVALID");
        cursor = requiredString(parseJson<{ historyId?: string }>(profile).historyId);
      }
      return { records, cursor };
    }
  },
  actions: {
    send_mail: {
      schema: sendMailSchema,
      async handle(context, input) {
        const mail = sendMailSchema.parse(input);
        const raw = [
          `To: ${mail.to}`,
          `Subject: ${mail.subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: 8bit",
          "",
          mail.text
        ].join("\r\n");
        const token = await context.secrets.open("oauth_access_token");
        const response = await context.http.send({
          method: "POST",
          url: `${api}/gmail/v1/users/me/messages/send`,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
          timeoutMs: 15_000
        });
        if (response.status !== 200) throw new ConnectorError(`GMAIL_${failure(response.status).toUpperCase()}`);
        const id = parseJson<{ id?: string }>(response).id;
        if (!id) throw new ConnectorError("GMAIL_RESPONSE_INVALID");
        return { externalId: id };
      }
    }
  }
});

async function initialIds(context: ConnectorContext<GmailConfig>, labelId: string): Promise<string[]> {
  const response = await request(
    context,
    `/gmail/v1/users/me/messages?labelIds=${encodeURIComponent(labelId)}&maxResults=${maxMessages}`
  );
  if (response.status !== 200) throw new ConnectorError(`GMAIL_${failure(response.status).toUpperCase()}`);
  return (parseJson<{ messages?: { id?: string }[] }>(response).messages ?? []).flatMap((item) =>
    item.id ? [item.id] : []
  );
}

async function historyIds(context: ConnectorContext<GmailConfig>, cursor: string, labelId: string): Promise<string[]> {
  const response = await request(
    context,
    `/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=${encodeURIComponent(labelId)}&maxResults=${maxMessages}`
  );
  if (response.status === 404) return initialIds(context, labelId);
  if (response.status !== 200) throw new ConnectorError(`GMAIL_${failure(response.status).toUpperCase()}`);
  const payload = parseJson<{ history?: { messagesAdded?: { message?: { id?: string } }[] }[] }>(response);
  return [
    ...new Set(
      (payload.history ?? [])
        .flatMap((entry) => entry.messagesAdded ?? [])
        .flatMap((entry) => (entry.message?.id ? [entry.message.id] : []))
    )
  ];
}

async function request(context: ConnectorContext<GmailConfig>, path: string) {
  const token = await context.secrets.open("oauth_access_token");
  return context.http.send({
    method: "GET",
    url: `${api}${path}`,
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: 15_000
  });
}

function normalize(message: GmailMessage) {
  const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name?.toLowerCase(), header.value]));
  const from = parseAddress(headers.get("from"));
  return {
    mailboxMessageId: message.id!,
    threadId: message.threadId ?? null,
    messageId: headers.get("message-id") ?? null,
    subject: headers.get("subject")?.slice(0, 500) ?? null,
    from: from?.address ?? null,
    fromName: from?.name ?? null,
    to: [],
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    preview: textOf(message.payload)?.slice(0, 4_000) ?? message.snippet?.slice(0, 4_000) ?? null
  };
}

function textOf(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (!part.filename && part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const value = textOf(child);
    if (value) return value;
  }
  return null;
}

function parseAddress(value: string | undefined): { address: string; name: string | null } | null {
  if (!value) return null;
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
  const address = (match?.[2] ?? value).trim().toLowerCase();
  if (!address.includes("@") || address.length > 320) return null;
  const name = match?.[1]?.trim().replace(/^"|"$/g, "").slice(0, 200) || null;
  return { address, name };
}

function parseJson<T>(response: HttpResponse): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new ConnectorError("GMAIL_RESPONSE_INVALID");
  }
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new ConnectorError("GMAIL_RESPONSE_INVALID");
  return value;
}
function maxDecimal(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return BigInt(left) > BigInt(right) ? left : right;
}
function failure(status: number) {
  return status === 401 || status === 403
    ? "unauthorized"
    : status === 429 || status >= 500
      ? "rate_limited"
      : "invalid_response";
}

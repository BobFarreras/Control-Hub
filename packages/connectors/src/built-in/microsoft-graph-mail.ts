import { z } from "zod";
import {
  ConnectorError,
  connectorContractVersion,
  defineConnector,
  failureForStatus,
  type ConnectorContext,
  type HttpResponse
} from "../contract.js";

const graphApi = "https://graph.microsoft.com";
const configSchema = z.strictObject({
  baseUrl: z.literal(graphApi).default(graphApi),
  mailbox: z.literal("me").default("me"),
  folderId: z.string().trim().min(1).max(256).default("inbox")
});
type Config = z.infer<typeof configSchema>;
type GraphMessage = {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  "@removed"?: unknown;
};
type DeltaPage = { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
const sendMailSchema = z.strictObject({
  to: z.email().max(320),
  subject: z
    .string()
    .min(1)
    .max(500)
    .refine((value) => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(20_000)
});

export const microsoftGraphMail = defineConnector<Config>({
  type: "microsoft_graph_mail",
  contractVersion: connectorContractVersion,
  configSchema,
  configFields: [
    { name: "baseUrl", kind: "url", group: "connection" },
    { name: "mailbox", kind: "text", group: "connection" },
    { name: "folderId", kind: "text", group: "behaviour" }
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
      provider: "microsoft",
      authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      revocationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/logout",
      scopes: ["openid", "offline_access", "Mail.Read", "Mail.Send"]
    }
  },
  async health(context) {
    const response = await request(context, "/v1.0/me?$select=id");
    return response.status === 200
      ? { status: "ok" }
      : { status: "failed", failure: failureForStatus(response.status)! };
  },
  operations: {
    async pull_messages(context, input) {
      const initial =
        `/v1.0/me/mailFolders/${encodeURIComponent(context.config.folderId)}/messages/delta` +
        "?$select=id,conversationId,internetMessageId,subject,bodyPreview,receivedDateTime,from,toRecipients&changeType=created";
      const url = input.cursor ? validateCursor(input.cursor) : `${graphApi}${initial}`;
      const response = await requestAbsolute(context, url);
      if (response.status !== 200)
        throw new ConnectorError(`GRAPH_${failureForStatus(response.status)!.toUpperCase()}`);
      const page = parseJson<DeltaPage>(response);
      const cursor = validateCursor(page["@odata.nextLink"] ?? page["@odata.deltaLink"] ?? "");
      const records = (page.value ?? []).filter((message) => !message["@removed"]).map(normalize);
      return { records, cursor };
    }
  },
  actions: {
    send_mail: {
      schema: sendMailSchema,
      async handle(context, input) {
        const mail = sendMailSchema.parse(input);
        const token = await context.secrets.open("oauth_access_token");
        const response = await context.http.send({
          method: "POST",
          url: `${graphApi}/v1.0/me/sendMail`,
          timeoutMs: 15_000,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              subject: mail.subject,
              body: { contentType: "Text", content: mail.text },
              toRecipients: [{ emailAddress: { address: mail.to } }]
            },
            saveToSentItems: true
          })
        });
        if (response.status !== 202)
          throw new ConnectorError(`GRAPH_${(failureForStatus(response.status) ?? "invalid_response").toUpperCase()}`);
        return { externalId: null };
      }
    }
  }
});

async function request(context: ConnectorContext<Config>, path: string) {
  return requestAbsolute(context, `${graphApi}${path}`);
}

async function requestAbsolute(context: ConnectorContext<Config>, url: string) {
  const token = await context.secrets.open("oauth_access_token");
  return context.http.send({
    method: "GET",
    url,
    timeoutMs: 15_000,
    headers: { authorization: `Bearer ${token}`, prefer: 'odata.maxpagesize="50", outlook.body-content-type="text"' }
  });
}

function validateCursor(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("GRAPH_CURSOR_INVALID");
  }
  if (url.origin !== graphApi || !url.pathname.startsWith("/v1.0/me/mailFolders/"))
    throw new ConnectorError("GRAPH_CURSOR_INVALID");
  if (value.length > 8_192) throw new ConnectorError("GRAPH_CURSOR_INVALID");
  return value;
}

function normalize(message: GraphMessage) {
  if (!message.id || !message.receivedDateTime) throw new ConnectorError("GRAPH_RESPONSE_INVALID");
  const receivedAt = new Date(message.receivedDateTime);
  if (Number.isNaN(receivedAt.getTime())) throw new ConnectorError("GRAPH_RESPONSE_INVALID");
  const sender = message.from?.emailAddress;
  return {
    externalId: message.id,
    data: {
      mailboxMessageId: message.id,
      threadId: message.conversationId ?? null,
      messageId: message.internetMessageId ?? null,
      subject: message.subject?.slice(0, 500) ?? null,
      from: sender?.address?.toLowerCase().slice(0, 320) ?? null,
      fromName: sender?.name?.slice(0, 200) ?? null,
      to: (message.toRecipients ?? []).flatMap((recipient) =>
        recipient.emailAddress?.address ? [recipient.emailAddress.address.slice(0, 320)] : []
      ),
      receivedAt: receivedAt.toISOString(),
      preview: message.bodyPreview?.slice(0, 4_000) ?? null
    }
  };
}

function parseJson<T>(response: HttpResponse): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new ConnectorError("GRAPH_RESPONSE_INVALID");
  }
}

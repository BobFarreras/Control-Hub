import { isAllowlistedDestination, type AllowedDestination } from "@control-hub/config";
import type {
  MailAddress,
  MailboxPort,
  MailChangePage,
  MailCursor,
  MailMessage,
  MailMessageRef,
  MailReadLimits,
  SecretsPort
} from "@control-hub/connectors";
import { isAllowedEgressAddress } from "@control-hub/domain";
import { ImapFlow } from "imapflow";
import PostalMime, { type Address } from "postal-mime";
import { EgressError, systemResolver, type AddressResolver } from "./guarded-fetch.js";

export type ManagedMailboxPort = MailboxPort & { close(): Promise<void> };

type ImapMailboxOptions = {
  mailboxUrl: string;
  secrets: SecretsPort;
  allowlist: readonly AllowedDestination[];
  resolve?: AddressResolver;
};

type Cursor = { uidValidity: string; uid: number };

export async function createImapMailbox(options: ImapMailboxOptions): Promise<ManagedMailboxPort> {
  const target = parseTarget(options.mailboxUrl);
  const resolved = await resolveTarget(target, options.allowlist, options.resolve ?? systemResolver);
  const [user, pass] = await Promise.all([
    options.secrets.open("imap_username"),
    options.secrets.open("imap_password")
  ]);
  const client = new ImapFlow({
    host: resolved.address,
    port: target.port,
    secure: true,
    servername: target.hostname,
    auth: { user, pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 30_000,
    maxLineLength: 128 * 1024,
    maxLiteralSize: 512 * 1024,
    maxResponseSize: 768 * 1024,
    tls: { rejectUnauthorized: true, servername: target.hostname }
  });
  client.on("error", () => undefined);
  await client.connect();

  return {
    async listFolders() {
      return (await client.list()).map((folder) => ({ id: folder.path, name: folder.name ?? folder.path }));
    },
    changes: (input) => changes(client, input),
    message: (reference, limits) => message(client, reference, limits),
    async close() {
      if (!client.usable) {
        client.close();
        return;
      }
      await client.logout().catch(() => client.close());
    }
  };
}

function parseTarget(raw: string): { url: URL; hostname: string; port: number } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressError("URL_NOT_PARSEABLE", "invalid_config");
  }
  if (url.protocol !== "imaps:") throw new EgressError("SCHEME_NOT_ALLOWED", "blocked_destination");
  if (url.username || url.password) throw new EgressError("URL_HAS_CREDENTIALS", "blocked_destination");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new EgressError("DESTINATION_OUTSIDE_BASE_URL", "blocked_destination");
  }
  const port = url.port ? Number(url.port) : 993;
  if (port !== 993) throw new EgressError("DESTINATION_NOT_ALLOWLISTED", "blocked_destination");
  return { url, hostname: url.hostname.replace(/^\[|]$/g, ""), port };
}

async function resolveTarget(
  target: { url: URL; hostname: string },
  allowlist: readonly AllowedDestination[],
  resolve: AddressResolver
) {
  let resolved: { address: string; family: number };
  try {
    resolved = await resolve(target.hostname);
  } catch {
    throw new EgressError("DNS_RESOLUTION_FAILED", "connection_reset");
  }
  if (isAllowedEgressAddress(resolved.address) || isAllowlistedDestination(allowlist, target.url)) return resolved;
  throw new EgressError("ADDRESS_NOT_ROUTABLE", "blocked_destination");
}

async function changes(client: ImapFlow, input: MailCursor): Promise<MailChangePage> {
  const lock = await client.getMailboxLock(input.folderId);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) throw new Error("MAILBOX_NOT_OPEN");
    const stored = decodeCursor(input.cursor);
    const lastUid = stored?.uidValidity === mailbox.uidValidity.toString() ? stored.uid : 0;
    const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
    const uids = (found || [])
      .filter((uid) => uid > lastUid)
      .sort((a, b) => a - b)
      .slice(0, input.limit);
    const page = [];
    for await (const item of client.fetch(uids, { uid: true, internalDate: true }, { uid: true })) {
      page.push({
        messageId: String(item.uid),
        receivedAt: item.internalDate ? new Date(item.internalDate) : new Date(0)
      });
    }
    const uid = page.length > 0 ? Number(page.at(-1)!.messageId) : lastUid;
    return { changes: page, cursor: encodeCursor({ uidValidity: mailbox.uidValidity.toString(), uid }) };
  } finally {
    lock.release();
  }
}

async function message(client: ImapFlow, reference: MailMessageRef, limits: MailReadLimits): Promise<MailMessage> {
  const lock = await client.getMailboxLock(reference.folderId);
  try {
    const fetched = await client.fetchOne(
      reference.messageId,
      {
        uid: true,
        internalDate: true,
        threadId: true,
        source: { maxLength: limits.maxHeaderBytes + limits.maxBodyBytes }
      },
      { uid: true }
    );
    if (!fetched || !fetched.source) throw new Error("MAILBOX_MESSAGE_NOT_FOUND");
    const parsed = await PostalMime.parse(fetched.source, {
      maxHeadersSize: limits.maxHeaderBytes,
      maxNestingDepth: 20,
      maxRfc822NestingDepth: 2,
      rfc822Attachments: true,
      attachmentEncoding: "arraybuffer"
    });
    return {
      id: String(fetched.uid),
      threadId: fetched.threadId ?? parsed.references ?? null,
      messageIdHeader: parsed.messageId ?? null,
      subject: parsed.subject ?? null,
      from: mailboxAddress(parsed.from),
      to: (parsed.to ?? []).flatMap(mailboxAddresses),
      receivedAt: fetched.internalDate
        ? new Date(fetched.internalDate)
        : parsed.date
          ? new Date(parsed.date)
          : new Date(0),
      text: parsed.text?.slice(0, limits.maxBodyBytes) ?? null
    };
  } finally {
    lock.release();
  }
}

function mailboxAddress(address: Address | undefined): MailAddress | null {
  return address ? (mailboxAddresses(address)[0] ?? null) : null;
}

function mailboxAddresses(address: Address): MailAddress[] {
  if (Array.isArray(address.group)) {
    return address.group.map((entry) => ({ address: entry.address, name: entry.name || null }));
  }
  return typeof address.address === "string" ? [{ address: address.address, name: address.name || null }] : [];
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    return typeof parsed.uidValidity === "string" && Number.isSafeInteger(parsed.uid) && parsed.uid! >= 0
      ? { uidValidity: parsed.uidValidity, uid: parsed.uid! }
      : null;
  } catch {
    return null;
  }
}

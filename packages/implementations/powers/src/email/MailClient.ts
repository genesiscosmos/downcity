/**
 * 短生命周期 IMAP 客户端。每次操作独立连接并关闭，不监听后台邮箱。
 * 强制校验证书和 TLS；日志关闭，底层认证错误不会携带凭据返回模型。
 */
import { ImapFlow } from "imapflow";
import type { FetchMessageObject, SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  EmailAccount,
  EmailIdentity,
  EmailListInput,
} from "./types/Email.js";

export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
/** 在单次取消、超时与连接失败下统一释放 IMAP。 */
export async function with_imap<T>(
  account: EmailAccount,
  signal: AbortSignal,
  operation: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    doSTARTTLS: !account.imap.secure,
    auth: { user: account.imap.user, pass: account.imap.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  // EventEmitter 必须显式消费异步 socket 错误，防止认证或退出失败导致进程异常。
  client.on("error", () => {});
  const operation_signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(60000),
  ]);
  const close = () => client.close();
  operation_signal.addEventListener("abort", close, { once: true });
  try {
    await client.connect();
    operation_signal.throwIfAborted();
    const result = await operation(client);
    operation_signal.throwIfAborted();
    return result;
  } finally {
    operation_signal.removeEventListener("abort", close);
    client.close();
  }
}
/** 邮箱锁限定 UID 有效代次；任何过期身份均拒绝操作。 */
export async function with_mailbox<T>(
  client: ImapFlow,
  mailbox: string,
  uid_validity: string | undefined,
  operation: (validity: string) => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    if (!client.mailbox) throw new Error("Mailbox not selected");
    const validity = String(client.mailbox.uidValidity);
    if (uid_validity !== undefined && validity !== uid_validity)
      throw new Error("Mailbox UIDVALIDITY changed; list messages again");
    return await operation(validity);
  } finally {
    lock.release();
  }
}
/** 列表投影，绝不把 IMAP 大对象或原始正文送入消息列表。 */
function message_summary(message: FetchMessageObject) {
  return {
    uid: message.uid,
    subject: message.envelope?.subject ?? "",
    from: message.envelope?.from ?? [],
    to: message.envelope?.to ?? [],
    date:
      message.envelope?.date instanceof Date
        ? message.envelope.date.toISOString()
        : (message.envelope?.date ?? null),
    message_id: message.envelope?.messageId ?? null,
    read: Boolean(message.flags?.has("\\Seen")),
    size: message.size ?? 0,
  };
}
/** 使用 UID 范围缩小搜索，并将分页游标绑定到搜索条件与 UIDVALIDITY。 */
export async function list_messages(client: ImapFlow, input: EmailListInput) {
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        input.account_id,
        input.mailbox,
        input.query?.text ?? "",
        input.query?.from ?? "",
        input.query?.subject ?? "",
        Boolean(input.query?.unseen),
      ]),
    )
    .digest("hex");
  const cursor = input.cursor
    ? z
        .object({
          scope: z.string(),
          uid_validity: z.string(),
          before_uid: z.number().int().positive(),
        })
        .strict()
        .parse(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        )
    : undefined;
  if (cursor && cursor.scope !== scope)
    throw new Error("Cursor does not match the mailbox/search");
  return with_mailbox(
    client,
    input.mailbox,
    cursor?.uid_validity,
    async (uid_validity) => {
      const query: SearchObject = { all: true };
      if (input.query?.text) query.text = input.query.text;
      if (input.query?.from) query.from = input.query.from;
      if (input.query?.subject) query.subject = input.query.subject;
      if (input.query?.unseen) query.seen = false;
      if (cursor) {
        if (cursor.before_uid <= 1)
          return { messages: [], uid_validity, next_cursor: null };
        query.uid = `1:${cursor.before_uid - 1}`;
      }
      const matches = await client.search(query, { uid: true });
      const ordered = (matches || []).sort((left, right) => right - left);
      const selected = ordered.slice(0, input.limit ?? 25);
      const messages: ReturnType<typeof message_summary>[] = [];
      // 不在 fetch 迭代期间执行其他 IMAP 命令，避免协议死锁。
      if (selected.length) {
        for await (const message of client.fetch(
          selected,
          { envelope: true, flags: true, size: true },
          { uid: true },
        ))
          messages.push(message_summary(message));
      }
      messages.sort((left, right) => right.uid - left.uid);
      const next_cursor =
        ordered.length > selected.length
          ? Buffer.from(
              JSON.stringify({
                scope,
                uid_validity,
                before_uid: selected.at(-1),
              }),
            ).toString("base64url")
          : null;
      return {
        account_id: input.account_id,
        mailbox: input.mailbox,
        uid_validity,
        messages,
        next_cursor,
      };
    },
  );
}
/** 在锁内读取有体积上限的 RFC822 源文；PEEK 读取不会隐式标记已读。 */
export async function read_message(
  client: ImapFlow,
  identity: EmailIdentity,
): Promise<ParsedMail> {
  return with_mailbox(
    client,
    identity.mailbox,
    identity.uid_validity,
    async () => {
      const metadata = await client.fetchOne(
        identity.uid,
        { size: true },
        { uid: true },
      );
      if (!metadata) throw new Error("Message no longer exists");
      if (!metadata.size || metadata.size > MAX_MESSAGE_BYTES)
        throw new Error("Message exceeds the 25 MiB read limit");
      const { content } = await client.download(identity.uid, undefined, {
        uid: true,
        maxBytes: MAX_MESSAGE_BYTES + 1,
      });
      if (!content) throw new Error("Message no longer exists");
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of content) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_MESSAGE_BYTES)
            throw new Error("Message exceeds the 25 MiB read limit");
          chunks.push(bytes);
        }
      } finally {
        content.destroy();
      }
      return simpleParser(Buffer.concat(chunks), {
        skipHtmlToText: false,
        skipTextToHtml: true,
        skipImageLinks: true,
      });
    },
  );
}

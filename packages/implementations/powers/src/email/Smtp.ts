/**
 * SMTP 认证与发送。连接测试不发送邮件；取消与超时都关闭连接。
 * SMTP 返回成功只代表服务端接受，不能推断最终投递，失败不自动重试。
 */
import nodemailer from "nodemailer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import type Mail from "nodemailer/lib/mailer/index.js";
import type { EmailAccount } from "./types/Email.js";

/** 使用独立连接校验 SMTP 认证，并在成功、失败或取消后释放 socket。 */
export async function verify_smtp(
  account: EmailAccount,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const client = new SMTPConnection({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    requireTLS: !account.smtp.secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    logger: false,
  });
  const operation_signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(60000),
  ]);
  let cancel: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(operation_signal.reason);
      operation_signal.addEventListener("abort", cancel, { once: true });
      client.on("error", reject);
      client.on("end", () =>
        reject(
          new Error("SMTP connection closed before authentication completed"),
        ),
      );
      client.connect((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (operation_signal.aborted) {
          reject(operation_signal.reason);
          return;
        }
        client.login(
          { user: account.smtp.user, pass: account.smtp.password },
          (login_error) => {
            if (login_error) reject(login_error);
            else resolve();
          },
        );
      });
    });
    operation_signal.throwIfAborted();
  } finally {
    operation_signal.removeEventListener("abort", cancel);
    client.close();
  }
}

/** 按次创建 SMTP Transport；发送取消使用 Nodemailer 的 signal 端口关闭实际连接。 */
export async function submit_message(
  account: EmailAccount,
  signal: AbortSignal,
  message: Mail.Options,
) {
  signal.throwIfAborted();
  const operation_signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(60000),
  ]);
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    requireTLS: !account.smtp.secure,
    auth: { user: account.smtp.user, pass: account.smtp.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  });
  try {
    // Nodemailer 10 支持 signal；单次发送由库负责关闭连接，close 仅清理 Transport 自身资源。
    const outgoing = {
      ...message,
      signal: operation_signal,
      from: { address: account.address, name: account.label },
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    const result = await transport.sendMail(outgoing);
    return {
      message_id: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      delivery_status: result.rejected.length
        ? "partially_accepted"
        : "smtp_accepted",
    };
  } finally {
    transport.close();
  }
}

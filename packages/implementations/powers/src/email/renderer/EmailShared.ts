/** 邮件界面的配置投影与领域调用；保持凭据单向输入、失败和审批结果显式可见。 */
import type { PowerActionGateway } from "@downcity/city/power/react";
import type { PowerJsonValue } from "@downcity/city/power";
import type { EmailAccountView } from "../types/Email.js";
import type {
  EmailAccountDraft,
  EmailOperationResult,
} from "../types/EmailDesktop.js";

/** 领域结果保留 success/data 封装，防止失败或拒绝审批被当作成功。 */
export async function invoke_email<T>(
  power: PowerActionGateway,
  action: string,
  agent_id: string,
  input: object,
): Promise<T> {
  if (!agent_id) throw new Error("请先选择可使用 Email 的 Agent");
  const result = await power.invoke<EmailOperationResult<T>>(
    `email.${action}`,
    { ...input, agent_id } as PowerJsonValue,
  );
  if (result.success !== true || result.data === undefined)
    throw new Error(result.error || result.message || "邮件操作未完成");
  return result.data;
}
/** 未知错误使用有意义的可见文本，密码不参与错误插值。 */
export function email_error(reason: unknown): string {
  return reason instanceof Error ? reason.message : "邮件操作未完成";
}
/** 为新账号提供常用的 TLS 端口；主机、身份和密码必须由用户填写。 */
export function empty_account(): EmailAccountDraft {
  return {
    id: `email_${crypto.randomUUID()}`,
    label: "",
    address: "",
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
    smtp: { host: "", port: 465, secure: true, user: "", password: "" },
    imap_password_configured: false,
    smtp_password_configured: false,
  };
}
/** 读取已保存账号后永远不给密码输入赋明文。 */
export function account_draft(account: EmailAccountView): EmailAccountDraft {
  return {
    id: account.id,
    label: account.label,
    address: account.address,
    imap: {
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      user: account.imap.user,
      password: "",
    },
    smtp: {
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      user: account.smtp.user,
      password: "",
    },
    imap_password_configured: account.imap.password_configured,
    smtp_password_configured: account.smtp.password_configured,
  };
}
/** 去除展示状态并省略空密码，复用服务端按认证目标保留密码的规则。 */
export function account_patch(
  account: EmailAccountView | EmailAccountDraft,
): PowerJsonValue {
  const draft =
    "imap_password_configured" in account ? account : account_draft(account);
  const server = (kind: "imap" | "smtp") => {
    const { password, ...fields } = draft[kind];
    return {
      ...fields,
      host: fields.host.trim(),
      user: fields.user.trim(),
      ...(password ? { password } : {}),
    };
  };
  return {
    id: draft.id,
    label: draft.label.trim(),
    address: draft.address.trim(),
    imap: server("imap"),
    smtp: server("smtp"),
  };
}
/** 日期显示交给当前宿主语言环境，不能解析时保留原值。 */
export function email_date(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
/** 人可读的附件体积。 */
export function email_size(size: number): string {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KiB`
      : `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

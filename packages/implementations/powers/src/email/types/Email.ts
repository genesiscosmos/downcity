/** Email Power 的账号、消息身份与收发协议；凭据只存在 Power 配置中。 */
import type { PowerJsonObject } from "@downcity/city/power";

/** 用户从 Desktop 明确提交的写信请求，不向模型开放此宿主协议。 */
export interface EmailComposeRequest {
  /** 执行及保存附件的 Agent。 */
  agent_id: string;
  /** 一次表单提交的稳定 UUID，失败重试复用。 */
  request_id: string;
  /** 已在宿主校验过的外发动作。 */
  action: "send" | "reply";
  /** 已按动作 schema 校验的完整数据。 */
  input: PowerJsonObject;
}

/** 已排队的 Chat 导航凭证，不表示邮件已发送。 */
export interface EmailComposeReceipt {
  /** 会话所属 Agent。 */
  agent_id: string;
  /** 会话稳定标识。 */
  session_id: string;
  /** 会话持久化分区。 */
  type: string;
  /** 已持久排队的 Turn 标识。 */
  turn_id: string;
}
export interface EmailServer {
  /** 邮件服务主机名，不接受 URL。 */
  host: string;
  /** TLS 或 STARTTLS 服务端口。 */
  port: number;
  /** true 使用隐式 TLS，false 强制 STARTTLS。 */
  secure: boolean;
  /** 独立的服务认证用户名。 */
  user: string;
  /** 服务密码或邮箱授权码，仅配置层可见。 */
  password: string;
}
export interface EmailAccount {
  /** 配置内唯一且稳定的账号标识。 */
  id: string;
  /** 界面显示名称。 */
  label: string;
  /** 发送时使用的邮箱地址。 */
  address: string;
  /** IMAP 认证与连接参数。 */
  imap: EmailServer;
  /** SMTP 认证与连接参数。 */
  smtp: EmailServer;
}
export interface EmailIdentity {
  /** 所属账号标识。 */
  account_id: string;
  /** IMAP 邮箱完整路径。 */
  mailbox: string;
  /** 仅在指定邮箱及 UIDVALIDITY 内有效的稳定 UID。 */
  uid: number;
  /** 邮箱 UID 有效代次，必须来自列表结果。 */
  uid_validity: string;
}
export interface EmailListInput {
  /** 所属账号标识。 */
  account_id: string;
  /** IMAP 邮箱完整路径。 */
  mailbox: string;
  /** 每页数量，默认 25，最大 100。 */
  limit?: number;
  /** 上页返回的游标；绑定账号、邮箱、搜索条件和邮箱代次。 */
  cursor?: string;
  /** 可选的服务端搜索条件，按 AND 组合。 */
  query?: {
    /** 全文包含的关键词。 */
    text?: string;
    /** 发件人搜索字符串。 */
    from?: string;
    /** 主题搜索字符串。 */
    subject?: string;
    /** true 仅列出未读邮件。 */
    unseen?: boolean;
  };
}
export interface EmailSendInput {
  /** 使用的发送账号，发件地址由该账号配置决定。 */
  account_id: string;
  /** 主送邮箱地址。 */
  to: string[];
  /** 可选抄送地址。 */
  cc?: string[];
  /** 可选密送地址。 */
  bcc?: string[];
  /** 邮件主题。 */
  subject: string;
  /** 纯文本邮件正文。 */
  text: string;
  /** 可选附件，仅接受本 Power 下载返回的附件标识。 */
  attachment_ids?: string[];
}
export interface EmailReplyInput extends EmailIdentity {
  /** 回复纯文本正文。 */
  text: string;
  /** true 回复全部原始 To/Cc，默认只回复 Reply-To 或 From。 */
  reply_all?: boolean;
  /** 可选附件，仅接受本 Power 下载返回的附件标识。 */
  attachment_ids?: string[];
}
export interface EmailCursor {
  /** 与账号、邮箱及搜索条件绑定的摘要。 */
  scope: string;
  /** 邮箱 UID 有效代次。 */
  uid_validity: string;
  /** 下一页严格小于该 UID。 */
  before_uid: number;
}
export type EmailServerView = Omit<EmailServer, "password"> & {
  /** 是否已有密码，不回显明文。 */
  password_configured: boolean;
};
export type EmailAccountView = Omit<EmailAccount, "imap" | "smtp"> & {
  /** 不含密码的 IMAP 配置。 */
  imap: EmailServerView;
  /** 不含密码的 SMTP 配置。 */
  smtp: EmailServerView;
};

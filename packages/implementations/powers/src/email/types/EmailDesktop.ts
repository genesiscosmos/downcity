/** Email 工作区的浏览器安全展示契约；不导入 IMAP、SMTP 或任何 Node 模块。 */
import type {
  PowerActionGateway,
  PowerRendererUi,
} from "@downcity/city/power/react";
import type { ReactNode } from "react";
import type { EmailAccount, EmailAccountView, EmailIdentity } from "./Email.js";

export interface EmailViewProps {
  /** 当前 Email Power 的宿主动作入口。 */
  power: PowerActionGateway;
  /** Desktop 注入的共享组件与反馈能力。 */
  ui: PowerRendererUi;
}
export interface EmailConfigSnapshot {
  /** 已保存且已脱敏的账号，不含任何认证密码。 */
  accounts: EmailAccountView[];
}
export interface EmailAgentSnapshot {
  /** 宿主可选择的 Agent 目录；执行时由核心核对 Email 权限。 */
  agents: {
    /** Agent 的稳定标识，调用时必须显式传递。 */
    agent_id: string;
    /** Agent 的显示名称。 */
    name: string;
  }[];
}
export interface EmailAccountDraft extends EmailAccount {
  /** 已存在的 IMAP 密码仅以配置状态表示，空输入表示保留。 */
  imap_password_configured: boolean;
  /** 已存在的 SMTP 密码仅以配置状态表示，空输入表示保留。 */
  smtp_password_configured: boolean;
}
export interface EmailMailboxSnapshot {
  /** 服务端返回的邮箱文件夹。 */
  mailboxes: {
    /** IMAP 完整路径，不能以显示名称替代。 */
    path: string;
    /** 文件夹显示名称。 */
    name: string;
    /** IMAP 特殊用途标记，可为空。 */
    special_use: string | null;
    /** false 表示该文件夹不能读取邮件。 */
    selectable: boolean;
  }[];
}
export interface EmailAddressView {
  /** MIME 显示名称。 */
  name?: string;
  /** 真实邮箱地址。 */
  address?: string;
}
export interface EmailMessageSummary {
  /** 邮件在当前邮箱代次中的稳定标识。 */
  uid: number;
  /** 邮件主题。 */
  subject: string;
  /** 发件人列表。 */
  from: EmailAddressView[];
  /** 收件人列表。 */
  to: EmailAddressView[];
  /** ISO 日期，缺失时为空。 */
  date: string | null;
  /** 是否已设置 Seen 标记。 */
  read: boolean;
  /** RFC822 邮件字节数。 */
  size: number;
}
export interface EmailMessagePage {
  /** 产生本页身份的 UID 有效代次。 */
  uid_validity: string;
  /** 按 UID 降序排列的一页邮件。 */
  messages: EmailMessageSummary[];
  /** 下一页的绑定游标；空表示末页。 */
  next_cursor: string | null;
}
export interface EmailMessageView extends EmailIdentity {
  /** 邮件主题。 */
  subject: string;
  /** 已校验的发件邮箱。 */
  from: string[];
  /** 回复优先使用的实际 Reply-To 邮箱；为空时使用 From。 */
  reply_to: string[];
  /** 已校验的主送邮箱。 */
  to: string[];
  /** 已校验的抄送邮箱。 */
  cc: string[];
  /** ISO 日期，缺失时为空。 */
  date: string | null;
  /** 有限长度的纯文本正文。 */
  text: string;
  /** 正文是否达到展示上限。 */
  truncated: boolean;
  /** 附件元数据，索引只对当前消息有效。 */
  attachments: {
    /** 传给附件动作的稳定 MIME 索引。 */
    attachment_index: number;
    /** 已去除路径的显示文件名。 */
    filename: string;
    /** 服务端声明的 MIME 类型。 */
    content_type: string;
    /** 附件字节数。 */
    size: number;
  }[];
}
export interface EmailDownloadedAttachment {
  /** Power 私有存储中的附件 ID，可用于发信。 */
  attachment_id: string;
  /** 下载后的显示文件名。 */
  filename: string;
  /** 已下载附件的字节数。 */
  size: number;
  /** Power 返回的宿主文件路径，仅用于展示。 */
  file_path: string;
}
export interface EmailOperationResult<T> {
  /** 领域动作是否实际成功；审批拒绝也不能显示为成功。 */
  success: boolean;
  /** 成功时的结构化业务数据。 */
  data?: T;
  /** 可展示的脱敏错误。 */
  error?: string;
  /** 补充执行状态或失败原因。 */
  message?: string;
}
export interface EmailConnectionResult {
  /** IMAP 与 SMTP 是否均验证成功。 */
  success: boolean;
  /** 已脱敏的测试结果。 */
  message: string;
}
export interface EmailComposeProps extends EmailViewProps {
  /** 用户显式选择的 Agent。 */
  agent_id: string;
  /** 用户显式选择的发件账号。 */
  account: EmailAccountView;
  /** 存在时通过原邮件身份进行回复。 */
  reply?: EmailMessageView;
  /** 本工作区本次下载的可选附件。 */
  attachments: EmailDownloadedAttachment[];
  /** 核心创建普通 Chat 后，交给 Desktop 打开原生会话与审批界面。 */
  open_session?: (target: EmailComposeSession) => Promise<void>;
  /** 关闭或成功交给 Agent 后返回邮件工作区。 */
  on_close(): void;
}
export interface EmailInboxProps extends EmailViewProps {
  /** 由工作区提供的统一 Agent 选择控件，放在同一可滚动页面内。 */
  scope_control: ReactNode;
  /** 执行所有邮箱操作的显式 Agent。 */
  agent_id: string;
  /** 当前选中的已保存账号。 */
  account: EmailAccountView;
  /** 宿主注入的原生 Chat 导航能力。 */
  open_session?: (target: EmailComposeSession) => Promise<void>;
}
export interface EmailSettingsProps extends EmailViewProps {
  /** 要编辑的账号；空字符串表示新建。 */
  account_id: string;
  /** 保存或删除后返回对应账号的邮件界面。 */
  on_saved(account_id: string): void;
}
export interface EmailComposeSession {
  /** 接手发送请求的 Agent。 */
  agent_id: string;
  /** 核心创建并已提交提示的普通 Chat Session。 */
  session_id: string;
}
export interface EmailRendererOptions {
  /** Desktop 注入的会话导航；不把 Desktop controller 泄漏给 Power。 */
  open_session(target: EmailComposeSession): Promise<void>;
}

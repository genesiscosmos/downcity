/**
 * Chat Channel Account 与存储契约。
 *
 * 关键点（中文）
 * - Chat Plugin 只依赖账号领域接口，不感知 SQLite、密钥文件或 CLI 全局路径。
 * - 具体存储由宿主注入；CLI 可以使用平台数据库，其他宿主可以使用内存或远程实现。
 * - 同步读取用于 Channel 启动时解析凭据，写入操作保持异步。
 */

/** Chat Account 支持的渠道。 */
export type StoredChannelAccountChannel = "telegram" | "feishu" | "qq";

/** Chat Account 的运行时明文记录。 */
export interface StoredChannelAccount {
  /** 账号的稳定主键。 */
  id: string;
  /** 账号所属渠道。 */
  channel: StoredChannelAccountChannel;
  /** 面向用户展示的账号名称。 */
  name: string;
  /** 平台身份展示文案。 */
  identity?: string;
  /** 平台返回的机器人所有者。 */
  owner?: string;
  /** 平台返回的机器人创建者。 */
  creator?: string;
  /** Telegram Bot Token 明文。 */
  botToken?: string;
  /** Feishu 或 QQ App ID 明文。 */
  appId?: string;
  /** Feishu 或 QQ App Secret 明文。 */
  appSecret?: string;
  /** Feishu/Lark API 域名。 */
  domain?: string;
  /** QQ 是否使用 Sandbox 环境。 */
  sandbox?: boolean;
  /** 账号创建时间 ISO 字符串。 */
  created_at: string;
  /** 账号最后更新时间 ISO 字符串。 */
  updated_at: string;
}

/** 新增或更新 Chat Account 的输入。 */
export interface UpsertChannelAccountInput {
  /** 账号的稳定主键。 */
  id: string;
  /** 账号所属渠道。 */
  channel: StoredChannelAccountChannel;
  /** 面向用户展示的账号名称。 */
  name: string;
  /** 平台身份展示文案。 */
  identity?: string;
  /** 平台返回的机器人所有者。 */
  owner?: string;
  /** 平台返回的机器人创建者。 */
  creator?: string;
  /** Telegram Bot Token 明文。 */
  botToken?: string;
  /** Feishu 或 QQ App ID 明文。 */
  appId?: string;
  /** Feishu 或 QQ App Secret 明文。 */
  appSecret?: string;
  /** Feishu/Lark API 域名。 */
  domain?: string;
  /** QQ 是否使用 Sandbox 环境。 */
  sandbox?: boolean;
}

/** 宿主注入 Chat Plugin 的账号存储能力。 */
export interface ChatChannelAccountStore {
  /** 同步列出账号；传入渠道时只返回该渠道的数据。 */
  list(channel_input?: string): StoredChannelAccount[];
  /** 同步按稳定 ID 读取账号。 */
  get(account_id_input: string): StoredChannelAccount | null;
  /** 新增或更新账号。 */
  upsert(input: UpsertChannelAccountInput): Promise<void>;
  /** 删除指定账号。 */
  remove(account_id_input: string): Promise<void>;
}

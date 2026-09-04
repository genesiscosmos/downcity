/**
 * Chat Bot 信息探测类型定义。
 *
 * 关键点（中文）
 * - 将“凭据 -> bot 基础信息”的探测输入输出结构标准化。
 * - Console、Chat Account 存储、后续自动化流程都复用该结构。
 */

import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";

/**
 * Bot 信息探测凭据。
 */
export interface ChatBotInfoCredentialInput {
  /**
   * Telegram 机器人 token（仅 Telegram 渠道使用）。
   */
  botToken?: string;
  /**
   * 应用 ID（Feishu/QQ 使用）。
   */
  appId?: string;
  /**
   * 应用密钥（Feishu/QQ 使用）。
   */
  appSecret?: string;
  /**
   * 平台域名（可选，主要用于 Feishu 私有部署或特殊网关）。
   */
  domain?: string;
  /**
   * 是否使用沙箱环境（QQ 使用）。
   */
  sandbox?: boolean;
}

/**
 * Bot 信息探测请求。
 */
export interface ChatBotInfoResolveInput {
  /**
   * 目标渠道名称。
   */
  channel: ChatChannelName;
  /**
   * 渠道对应的认证凭据。
   */
  credentials: ChatBotInfoCredentialInput;
}

/**
 * Bot 信息探测结果。
 */
export interface ChatBotInfoResult {
  /**
   * 渠道名称。
   */
  channel: ChatChannelName;
  /**
   * Bot 展示名称（用于 Console 列表展示和默认命名）。
   */
  name: string;
  /**
   * Bot 身份标识（通常是用户名/open_id/appId 等）。
   */
  identity?: string;
  /**
   * Bot 所有者信息（可选；平台可获取时返回）。
   */
  owner?: string;
  /**
   * Bot 创建者信息（可选；平台可获取时返回）。
   */
  creator?: string;
  /**
   * 平台返回的 bot 用户唯一 ID（若可获取）。
   */
  botUserId?: string;
  /**
   * 建议用于生成 chat account id 的稳定种子。
   */
  idSeed?: string;
  /**
   * 探测结果描述。
   */
  message: string;
}

/**
 * 渠道级 Bot 信息探测器接口。
 */
export interface ChatChannelBotInfoProvider {
  /**
   * 当前探测器对应渠道。
   */
  readonly channel: ChatChannelName;
  /**
   * 使用凭据探测并返回标准化 bot 信息。
   */
  resolve(credentials: ChatBotInfoCredentialInput): Promise<ChatBotInfoResult>;
}

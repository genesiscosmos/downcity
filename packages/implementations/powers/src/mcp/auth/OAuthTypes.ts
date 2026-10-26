/**
 * MCP OAuth 鉴权的类型定义。
 *
 * 授权协议流程（发现、PKCE、动态注册、刷新）全部复用
 * @modelcontextprotocol/sdk 的 auth 编排器，本模块只定义持久化形态、
 * 运行时状态与配置扩展，不自行定义协议 wire 类型。
 */

import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** 单个 HTTP server 的持久化凭据集合。 */
export interface McpOAuthCredential {
  /** 凭据对应的授权服务器 issuer URL，防止凭据被提交给其他服务器。 */
  issuer: string;
  /** 已注册的客户端信息（动态注册结果或配置预置的 client_id）。 */
  client?: OAuthClientInformationMixed;
  /** MCP endpoint，防止 URL 修改后复用其他资源的凭据。 */
  endpoint: string;
  /** access token 的绝对过期时间，毫秒。 */
  expires_at?: number;
  /** 最近一次成功换取的 token 集合；尚未授权时为 undefined。 */
  tokens?: OAuthTokens;
}

/** OAuth 授权的运行时状态，用于状态展示与并发去重。 */
export type McpOAuthState = "none" | "authorized" | "authorizing" | "expired";

/** HTTP 传输的 OAuth 配置扩展，写入 server TOML。 */
export interface McpOAuthTransportConfig {
  /**
   * 标明远端使用 OAuth；省略时仍由标准 401 自动触发授权发现。
   */
  auth?: "oauth";
  /**
   * 授权服务器不支持动态客户端注册时预置的 client_id。
   * 未配置时使用 SDK 动态注册。
   */
  client_id?: string;
  /** 动态注册使用的客户端名称，默认使用 downcity。 */
  client_name?: string;
}

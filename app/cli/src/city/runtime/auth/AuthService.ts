/**
 * 单 Agent Bearer Token 服务。
 *
 * 关键点（中文）
 * - 每个服务实例只服务一个 Agent Gateway。
 * - Token 对所属 Agent 的非公开 HTTP API 拥有完整能力，不引入用户、角色与权限。
 * - 明文 Token 只在创建时返回一次。
 */

import { randomUUID } from "node:crypto";
import { AuthError } from "@/city/runtime/auth/AuthError.js";
import {
  extractBearerToken,
  generateAccessToken,
  hashAccessToken,
} from "@/city/runtime/auth/TokenService.js";
import type { AgentTokenRepository } from "@/city/runtime/auth/AgentTokenRepository.js";
import type {
  AgentTokenPrincipal,
  AgentTokenSummary,
  IssuedAgentToken,
} from "@/city/types/auth/AgentToken.js";

/** AuthService 构造参数。 */
export interface AuthServiceOptions {
  /** 当前 Gateway 所属 Agent ID。 */
  agent_id: string;
  /** CLI 组合根注入的 Token 仓储。 */
  repository: AgentTokenRepository;
}

/** 单 Agent Token 服务。 */
export class AuthService {
  private readonly agent_id: string;
  /** 当前服务使用的唯一 Token 仓储。 */
  private readonly repository: AgentTokenRepository;

  constructor(options: AuthServiceOptions) {
    this.agent_id = String(options.agent_id || "").trim();
    if (!this.agent_id) throw new Error("agent_id is required");
    this.repository = options.repository;
  }

  /** AuthService 不拥有连接，仅保留宿主统一关闭协议。 */
  close(): void {}

  /** 列出当前 Agent 的全部 Token 摘要。 */
  list_tokens(): AgentTokenSummary[] {
    return this.repository.list(this.agent_id)
      .map(({ token_hash: _hash, ...item }) => item);
  }

  /** 为当前 Agent 创建新 Token。 */
  create_token(input: { name: string; expires_at?: string }): IssuedAgentToken {
    const name = String(input.name || "").trim();
    if (!name) throw new AuthError("Token name is required", 400);
    const expires_at = normalize_expiry(input.expires_at);
    const token = generateAccessToken();
    const current_time = new Date().toISOString();
    const record = {
      token_id: randomUUID(),
      agent_id: this.agent_id,
      name,
      token_hash: hashAccessToken(token),
      ...(expires_at ? { expires_at } : {}),
      created_at: current_time,
      updated_at: current_time,
    };
    this.repository.create(record);
    const { token_hash: _hash, ...summary } = record;
    return { ...summary, token };
  }

  /** 删除当前 Agent 的一个 Token。 */
  delete_token(token_id_input: string): void {
    const token_id = String(token_id_input || "").trim();
    if (!token_id) throw new AuthError("token_id is required", 400);
    const removed = this.repository.remove(this.agent_id, token_id);
    if (!removed) throw new AuthError("Token not found", 404);
  }

  /** 校验 Authorization 头，并确保 Token 属于当前 Agent。 */
  authenticate_bearer_header(header_value: string | undefined): AgentTokenPrincipal {
    const token = extractBearerToken(header_value);
    if (!token) throw new AuthError("Missing bearer token", 401);
    const token_hash = hashAccessToken(token);
    const record = this.repository.get_by_hash(token_hash);
    if (!record || record.agent_id !== this.agent_id) {
      throw new AuthError("Invalid bearer token", 401);
    }
    if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
      throw new AuthError("Token is expired", 401);
    }
    const current_time = new Date().toISOString();
    this.repository.touch(record.token_id, current_time);
    return {
      agent_id: record.agent_id,
      token_id: record.token_id,
      token_name: record.name,
    };
  }
}

/** 规范化可选过期时间。 */
function normalize_expiry(input: string | undefined): string | undefined {
  const raw = String(input || "").trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new AuthError("Invalid expires_at", 400);
  if (date.getTime() <= Date.now()) throw new AuthError("expires_at must be in the future", 400);
  return date.toISOString();
}

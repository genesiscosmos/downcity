/**
 * Desktop Federation 登录事务。
 *
 * 该模块只维护短期登录流程和并发约束；账户校验、持久化与激活由
 * DesktopUserController 负责。
 */

import { Embassy, type EmbassyAccountLoginResult } from "@downcity/federation";
import type {
  DesktopLoginResult,
  DesktopLoginStartInput,
  DesktopLoginStartResult,
} from "../../common/types/DesktopApi.js";

const default_transaction_ttl_ms = 3 * 60_000;
const max_login_transactions = 32;
const desktop_bureau_id = "downcity";

interface PendingLoginTransaction {
  /** 当前登录使用的 Embassy 实例。 */
  embassy: Embassy;
  /** 登录 Provider 稳定标识。 */
  provider_id: string;
  /** 规范化后的 Federation 地址。 */
  federation_url: string;
  /** 当前事务失效时间戳。 */
  expires_at: number;
  /** 当前是否已有轮询请求在执行。 */
  polling: boolean;
}

/** 登录事务需要的可替换运行时依赖。 */
export interface DesktopLoginTransactionDependencies {
  /** 返回当前时间戳。 */
  now(): number;
  /** 为指定 Federation 创建 Embassy。 */
  create_embassy(federation_url: string): Embassy;
  /** 登录完成后校验、保存并激活账户。 */
  complete_login(federation_url: string, user_token: string): Promise<void>;
}

/** 管理有界、可取消且一次性消费结果的 Federation 登录事务。 */
export class DesktopLoginTransaction {
  private readonly transactions = new Map<string, PendingLoginTransaction>();
  private readonly dependencies: DesktopLoginTransactionDependencies;
  private readonly transaction_ttl_ms: number;

  constructor(
    dependencies: DesktopLoginTransactionDependencies,
    transaction_ttl_ms = default_transaction_ttl_ms,
  ) {
    this.dependencies = dependencies;
    this.transaction_ttl_ms = transaction_ttl_ms;
  }

  /** 启动一个 Provider 登录流程。 */
  async start(input: DesktopLoginStartInput): Promise<DesktopLoginStartResult> {
    this.remove_expired();
    if (this.transactions.size >= max_login_transactions) throw new Error("登录请求过多，请稍后重试");
    const provider_id = read_required_string(input.provider_id, "登录 Provider");
    const federation_url = normalize_federation_url(input.federation_url);
    const embassy = this.dependencies.create_embassy(federation_url);
    const result = await embassy.user.account.login_start({ provider: provider_id, bureau_id: desktop_bureau_id });
    throw_remote_error(result);
    if (result.status === "done") {
      await this.complete_result(federation_url, embassy, result);
      return to_start_result(result);
    }
    this.transactions.set(result.login_id, {
      embassy,
      provider_id,
      federation_url,
      expires_at: this.dependencies.now() + this.transaction_ttl_ms,
      polling: false,
    });
    return to_start_result(result);
  }

  /** 查询一次登录结果；完成和失败结果只允许消费一次。 */
  async poll(login_id: string): Promise<DesktopLoginResult> {
    const normalized_login_id = read_required_string(login_id, "登录请求");
    this.remove_expired();
    const transaction = this.transactions.get(normalized_login_id);
    if (!transaction) throw new Error("登录请求已失效");
    if (transaction.polling) throw new Error("登录请求正在查询中");
    transaction.polling = true;
    let result: EmbassyAccountLoginResult;
    try {
      result = await transaction.embassy.user.account.status(normalized_login_id);
    } finally {
      if (this.transactions.get(normalized_login_id) === transaction) transaction.polling = false;
    }
    if (this.transactions.get(normalized_login_id) !== transaction || transaction.expires_at <= this.dependencies.now()) {
      this.transactions.delete(normalized_login_id);
      throw new Error("登录请求已失效");
    }
    if (result.error) {
      this.transactions.delete(normalized_login_id);
      return { status: "error", login_id: normalized_login_id, error: result.error };
    }
    if (result.status !== "done") return { status: "pending", login_id: normalized_login_id };
    this.transactions.delete(normalized_login_id);
    await this.complete_result(transaction.federation_url, transaction.embassy, result);
    return { status: "done", login_id: normalized_login_id };
  }

  /** 取消并遗忘一个登录事务。 */
  cancel(login_id: string): void {
    this.transactions.delete(String(login_id || "").trim());
  }

  private async complete_result(
    federation_url: string,
    embassy: Embassy,
    result: EmbassyAccountLoginResult,
  ): Promise<void> {
    if (result.status !== "done") throw new Error("登录尚未完成");
    const user_token = embassy.user.account.token() || result.user_token;
    if (!user_token) throw new Error("登录未返回用户 Token");
    await this.dependencies.complete_login(federation_url, user_token);
  }

  private remove_expired(): void {
    const current_time = this.dependencies.now();
    for (const [login_id, transaction] of this.transactions) {
      if (transaction.expires_at <= current_time) this.transactions.delete(login_id);
    }
  }
}

function to_start_result(result: EmbassyAccountLoginResult): DesktopLoginStartResult {
  return {
    status: result.status,
    login_id: result.login_id,
    provider_id: result.provider || "",
    ...(result.status === "redirect_required" ? { url: result.url } : {}),
    ...(result.status === "input_required" ? { inputs: result.inputs } : {}),
  };
}

function throw_remote_error(result: EmbassyAccountLoginResult): void {
  if (result.error) throw new Error(result.error);
}

function normalize_federation_url(value: string): string {
  const url = new URL(read_required_string(value, "Federation 地址"));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Federation 地址必须使用 HTTP 或 HTTPS");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

function read_required_string(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field}不能为空`);
  return normalized;
}

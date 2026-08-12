/**
 * Embassy 用户账户访问器。
 *
 * 该模块封装现有 Accounts Service 登录原语，并把成功返回的 User Token
 * 写回当前 Embassy 实例。宿主仍负责交互和持久化。
 */

import type {
  EmbassyAccountContinueInput,
  EmbassyAccountDoneResult,
  EmbassyAccountLoginOptions,
  EmbassyAccountLoginResult,
  EmbassyAccountLoginStartInput,
  EmbassyAccountProvider,
} from "./types/EmbassyAccount.js";
import type { EmbassyAccountOptions } from "./types/EmbassyInternal.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 180;

/** Federation Accounts Service 访问器。 */
export class EmbassyAccount {
  private readonly options: EmbassyAccountOptions;
  private login_id?: string;

  constructor(options: EmbassyAccountOptions) {
    this.options = options;
  }

  /** 读取 Federation 动态发布的登录 Provider。 */
  async providers(): Promise<EmbassyAccountProvider[]> {
    const result = await this.options.accounts()
      .get<{ items?: EmbassyAccountProvider[] }>("providers");
    return result.items ?? [];
  }

  /** 开始一个现有 Accounts Service 登录流程。 */
  async login_start(
    input: EmbassyAccountLoginStartInput,
  ): Promise<EmbassyAccountLoginResult> {
    const result = await this.options.accounts()
      .action("login/start")
      .invoke<EmbassyAccountLoginResult>({
        ...input,
        bureau_id: input.bureau_id ?? this.options.bureau_id,
      });
    this.login_id = read_login_id(result);
    this.accept_user_token(result);
    return result;
  }

  /** 向当前登录流程提交 Provider 输入。 */
  async continue(
    input: EmbassyAccountContinueInput,
  ): Promise<EmbassyAccountLoginResult> {
    const login_id = read_required_login_id(input.login_id ?? this.login_id);
    const result = await this.options.accounts()
      .action("login/continue")
      .invoke<EmbassyAccountLoginResult>({
        ...input,
        login_id,
      });
    this.login_id = read_login_id(result);
    this.accept_user_token(result);
    return result;
  }

  /** 查询当前登录流程状态。 */
  async status(login_id?: string): Promise<EmbassyAccountLoginResult> {
    const current_login_id = read_required_login_id(login_id ?? this.login_id);
    const result = await this.options.accounts()
      .get<EmbassyAccountLoginResult>("login/result", {
        login_id: current_login_id,
      });
    this.login_id = read_login_id(result);
    this.accept_user_token(result);
    return result;
  }

  /**
   * 执行一次宿主无关的登录编排。
   *
   * 没有提供输入或 OAuth 回调时，返回当前步骤，由宿主继续处理。
   */
  async login(options: EmbassyAccountLoginOptions): Promise<EmbassyAccountLoginResult> {
    let result = await this.login_start(options);
    if (result.status === "input_required") {
      if (!options.input) return result;
      result = await this.continue({
        login_id: result.login_id,
        input: options.input,
      });
    }
    if (result.status === "redirect_required") {
      if (!options.on_authorize) return result;
      await options.on_authorize(result.url);
      return await this.poll_until_complete(options);
    }
    if (result.status === "pending") {
      return await this.poll_until_complete(options);
    }
    if (result.status === "done" && !result.user_token) {
      return await this.status(result.login_id);
    }
    return result;
  }

  /** 读取当前 Embassy 实例中的 User Token。 */
  token(): string | undefined {
    return this.options.read_user_token();
  }

  /** 清理当前 Embassy 实例中的 User Session。 */
  logout(): void {
    this.login_id = undefined;
    this.options.update_user_token(undefined);
  }

  private async poll_until_complete(
    options: EmbassyAccountLoginOptions,
  ): Promise<EmbassyAccountLoginResult> {
    const interval_ms = read_positive_integer(
      options.poll_interval_ms,
      DEFAULT_POLL_INTERVAL_MS,
      "poll_interval_ms",
    );
    const max_attempts = read_positive_integer(
      options.max_poll_attempts,
      DEFAULT_MAX_POLL_ATTEMPTS,
      "max_poll_attempts",
    );
    let result: EmbassyAccountLoginResult | undefined;
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      result = await this.status();
      if (result.status === "done") return result;
      await new Promise<void>((resolve) => setTimeout(resolve, interval_ms));
    }
    throw new Error("Federation account login timed out");
  }

  private accept_user_token(result: EmbassyAccountLoginResult): void {
    if (result.status !== "done") return;
    const done = result as EmbassyAccountDoneResult;
    if (typeof done.user_token === "string" && done.user_token.trim()) {
      this.options.update_user_token(done.user_token.trim());
    }
  }
}

function read_login_id(result: EmbassyAccountLoginResult): string {
  return read_required_login_id(result.login_id);
}

function read_required_login_id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("login_id is required");
  }
  return value.trim();
}

function read_positive_integer(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(field + " must be a positive integer");
  }
  return value;
}

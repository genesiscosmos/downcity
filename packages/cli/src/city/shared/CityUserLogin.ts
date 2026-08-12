/**
 * City user 登录流程。
 *
 * 关键点（中文）
 * - 只负责通过 City user auth providers 获取 user_token。
 * - 不读写 City 本地状态，调用方负责持久化 session。
 */

import prompts from "@/city/tui/Prompts.js";
import { Embassy } from "@downcity/federation";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import type {
  CityLoginInput,
  CityUserSession,
} from "@/city/types/CitySession.js";
import type {
  AccountsProviderItem,
  AuthContinueResult,
  AuthStartResult,
  AuthOption,
  LoginPollResult,
  RegisterResult,
  CityAuthMethod,
  VerifyResult,
} from "@/city/types/CityAuth.js";
import type { CityAccountsMeResult } from "@/city/types/CityUser.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapProvidersToOptions(items: AccountsProviderItem[]): AuthOption[] {
  const options: AuthOption[] = [];
  for (const item of items) {
    if (!item.enabled) continue;
    if (item.id === "email" && item.type === "input") {
      if (item.login_enabled !== false) {
        options.push({
          title: "Email Login",
          value: "login",
          description: "Sign in with email + password",
        });
      }
      if (item.register_enabled !== false) {
        options.push({
          title: "Email Register",
          value: "register",
          description: "Create a new user account",
        });
      }
      continue;
    }
    if (item.type === "input" && typeof item.id === "string" && item.id.trim()) {
      const provider = item.id.trim();
      options.push({
        title: item.label?.trim() || formatProviderLabel(provider),
        value: `input:${provider}`,
        description: `Sign in with ${item.label?.trim() || formatProviderLabel(provider)}`,
      });
      continue;
    }
    if (item.type === "oauth" && typeof item.id === "string" && item.id.trim()) {
      const provider = item.id.trim();
      options.push({
        title: formatProviderLabel(provider),
        value: `oauth:${provider}`,
        description: `Sign in with ${formatProviderLabel(provider)} OAuth`,
      });
    }
  }
  return options;
}

async function loadAuthOptions(federation_url: string): Promise<AuthOption[]> {
  const embassy = new Embassy({ federation_url });
  const accounts = embassy.user.service("accounts");
  const result = await accounts.get<{ items?: AccountsProviderItem[] }>("providers");
  return mapProvidersToOptions(result.items ?? []);
}

async function promptAuthMethod(federation_url: string): Promise<CityAuthMethod | null> {
  const auth_options = await loadAuthOptions(federation_url);
  if (auth_options.length === 0) {
    emitCliBlock({
      tone: "warning",
      title: "No sign-in methods",
      note: "This City base has no enabled user auth providers.",
    });
    return null;
  }
  const response = (await prompts({
    type: "select",
    name: "method",
    message: "Sign in",
    choices: auth_options.map((item) => ({
      title: item.title,
      description: item.description,
      value: item.value,
    })),
  })) as { method?: CityAuthMethod };
  return response.method ?? null;
}

async function emailLogin(input: CityLoginInput): Promise<CityUserSession | null> {
  const response = (await prompts([
    {
      type: "text",
      name: "email",
      message: "email",
    },
    {
      type: "password",
      name: "password",
      message: "password",
    },
  ])) as { email?: string; password?: string };
  const email = readString(response.email);
  const password = String(response.password || "");
  if (!email || !email.includes("@") || !password) return null;

  const embassy = new Embassy({ federation_url: input.federation_url });
  const accounts = embassy.user.service("accounts");
  const started = await accounts.action("login/start").invoke<AuthStartResult>({
    provider: "email",
    bureau_id: input.bureau_id,
  });
  if (started.error || started.status !== "input_required" || !started.login_id) {
    throw new Error(started.error || "failed to start email login");
  }

  const continued = await accounts.action("login/continue").invoke<AuthContinueResult>({
    login_id: started.login_id,
    input: { email, password },
  });
  if (continued.error || continued.status !== "done") {
    throw new Error(continued.error || "login failed");
  }

  const result = await readLoginResult(embassy, started.login_id);
  if (!result || result.error || !result.user_token) {
    throw new Error(result?.error || "login failed: no token");
  }
  return await buildVerifiedUserSession({
    ...input,
    user_token: result.user_token,
    user_id: result.user_id,
    user_label: result.email || email,
  });
}

async function emailRegister(input: CityLoginInput): Promise<CityUserSession | null> {
  const response = (await prompts([
    {
      type: "text",
      name: "email",
      message: "email",
    },
    {
      type: "password",
      name: "password",
      message: "password (min 8 characters)",
    },
  ])) as { email?: string; password?: string };
  const email = readString(response.email);
  const password = String(response.password || "");
  if (!email || !email.includes("@")) throw new Error("invalid email");
  if (password.length < 8) throw new Error("password must be at least 8 characters");

  const embassy = new Embassy({ federation_url: input.federation_url });
  const accounts = embassy.user.service("accounts");
  const registered = await accounts.action("register").invoke<RegisterResult>({
    email,
    password,
  });
  if (registered.error || !registered.success) {
    throw new Error(registered.error || "registration failed");
  }

  emitCliBlock({
    tone: "success",
    title: "Verification code sent",
    note: "If email delivery is unavailable, check server logs for the verification code.",
  });

  const verify_response = (await prompts({
    type: "text",
    name: "verification_token",
    message: "verification token",
  })) as { verification_token?: string };
  const verification_token = readString(verify_response.verification_token);
  if (!verification_token) return null;

  const verified = await accounts.action("verify-email").invoke<VerifyResult>({
    token: verification_token,
    bureau_id: input.bureau_id,
  });
  if (verified.error || !verified.user_token) {
    throw new Error(verified.error || "verification failed: no token");
  }
  return await buildVerifiedUserSession({
    ...input,
    user_token: verified.user_token,
    user_id: verified.user_id || registered.user_id,
    user_label: email,
  });
}

async function oauthAuth(
  input: CityLoginInput,
  provider: string,
): Promise<CityUserSession | null> {
  const embassy = new Embassy({ federation_url: input.federation_url });
  const accounts = embassy.user.service("accounts");
  const started = await accounts.action("login/start").invoke<AuthStartResult>({
    provider,
    bureau_id: input.bureau_id,
  });
  if (started.error || started.status !== "redirect_required" || !started.url || !started.login_id) {
    throw new Error(started.error || "failed to start OAuth");
  }

  const opened = open_system_browser(started.url);
  emitCliBlock({
    tone: opened ? "info" : "warning",
    title: `OAuth: ${formatProviderLabel(provider)}`,
    summary: opened
      ? "Browser opened. Complete authorization to continue."
      : "Open the authorization URL in a browser to continue.",
    facts: [
      { label: "authorization_url", value: started.url },
      { label: "browser", value: opened ? "opened" : "not opened" },
    ],
    note: "Waiting for browser authorization...",
  });

  const result = await pollLoginResult(embassy, started.login_id);
  if (!result || result.error || !result.user_token) {
    throw new Error(result?.error || "OAuth failed");
  }
  return await buildVerifiedUserSession({
    ...input,
    user_token: result.user_token,
    user_id: result.user_id,
    user_label: result.email || `${provider}:${result.user_id || ""}`,
  });
}

async function inputAuth(
  input: CityLoginInput,
  provider: string,
): Promise<CityUserSession | null> {
  const embassy = new Embassy({ federation_url: input.federation_url });
  const started = await embassy.user.service("accounts").action("login/start").invoke<AuthStartResult>({
    provider,
    bureau_id: input.bureau_id,
  });
  if (started.error || started.status !== "done" || !started.login_id) {
    throw new Error(started.error || "login failed");
  }
  const result = await readLoginResult(embassy, started.login_id);
  if (!result || result.error || !result.user_token) {
    throw new Error(result?.error || "login failed: no token");
  }
  return await buildVerifiedUserSession({
    ...input,
    user_token: result.user_token,
    user_id: result.user_id,
    user_label: result.email || result.user_id || provider,
  });
}

async function pollLoginResult(embassy: Embassy, login_id: string): Promise<LoginPollResult | null> {
  for (let index = 0; index < 180; index += 1) {
    try {
      const result = await readLoginResult(embassy, login_id);
      if (result.error) return result;
      if (result.status === "done") return result;
    } catch {
      // 关键点（中文）：登录结果短暂不可达时继续轮询，避免网络抖动直接中断登录。
    }
    await sleep(1000);
  }
  return { error: "login timed out" };
}

async function readLoginResult(embassy: Embassy, login_id: string): Promise<LoginPollResult> {
  return await embassy.user.service("accounts").get<LoginPollResult>("login/result", { login_id });
}

function buildUserSession(input: CityLoginInput & {
  user_token: string;
  user_id?: string;
  user_label?: string;
}): CityUserSession {
  return {
    federation_url: input.federation_url,
    bureau_id: input.bureau_id,
    user_token: input.user_token,
    user_id: readString(input.user_id) || undefined,
    user_label: readString(input.user_label) || undefined,
    updated_at: new Date().toISOString(),
  };
}

async function buildVerifiedUserSession(input: CityLoginInput & {
  user_token: string;
  user_id?: string;
  user_label?: string;
}): Promise<CityUserSession> {
  const verified = await readUserSessionFromToken(input);
  return buildUserSession({
    ...input,
    bureau_id: verified.bureau_id,
    user_id: verified.user_id || input.user_id,
    user_label: verified.user_label || input.user_label,
  });
}

async function readUserSessionFromToken(input: CityLoginInput & {
  user_token: string;
}): Promise<{
  bureau_id: string;
  user_id?: string;
  user_label?: string;
}> {
  const embassy = new Embassy({
    federation_url: input.federation_url,
    user_token: input.user_token,
  });
  const result = await embassy.user.service("accounts").get<CityAccountsMeResult>("me");
  const bureau_id = typeof result.user?.bureau_id === "string"
    ? result.user.bureau_id
    : "";
  const user_id = readString(result.user?.user_id);
  if (!bureau_id) {
    throw new Error("City user token resolved without a bureau_id.");
  }
  const email = readString(result.profile?.email);
  const display_name = readString(result.profile?.display_name);
  return {
    bureau_id,
    user_id: user_id || undefined,
    user_label: email || display_name || user_id || undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return "OAuth";
  if (normalized === "github") return "GitHub";
  if (normalized === "google") return "Google";
  if (normalized === "wechat") return "WeChat";
  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * 执行 City user 登录。
 */
export async function performCityUserLogin(
  input: CityLoginInput,
): Promise<CityUserSession | null> {
  if (typeof input.bureau_id !== "string" || input.bureau_id.length === 0) {
    throw new TypeError("bureau_id is required");
  }
  const method = await promptAuthMethod(input.federation_url);
  if (!method) return null;
  if (method.startsWith("oauth:")) {
    return await oauthAuth(input, method.slice("oauth:".length));
  }
  if (method.startsWith("input:")) {
    return await inputAuth(input, method.slice("input:".length));
  }
  if (method === "register") {
    return await emailRegister(input);
  }
  return await emailLogin(input);
}

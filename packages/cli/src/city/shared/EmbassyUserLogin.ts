/**
 * Embassy 用户登录流程。
 *
 * 关键点（中文）
 * - 只负责通过 Embassy Account providers 获取 User Token。
 * - 不读写 Downcity 本地状态，调用方负责持久化 Session。
 */

import prompts from "@/city/tui/Prompts.js";
import {
  Embassy,
  type EmbassyAccountDoneResult,
  type EmbassyAccountLoginResult,
  type EmbassyAccountProvider,
} from "@downcity/federation";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { can_open_system_browser, open_system_browser } from "@/shared/SystemBrowser.js";
import { create_loopback_login_callback } from "@downcity/federation/node";
import type {
  EmbassyLoginInput,
  EmbassyUserSession,
} from "@/city/types/EmbassySession.js";
import type {
  AuthOption,
  RegisterResult,
  EmbassyAuthMethod,
  VerifyResult,
} from "@/city/types/EmbassyAuth.js";

function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function map_providers_to_options(items: EmbassyAccountProvider[]): AuthOption[] {
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
        title: item.label?.trim() || format_provider_label(provider),
        value: `input:${provider}`,
        description: `Sign in with ${item.label?.trim() || format_provider_label(provider)}`,
      });
      continue;
    }
    if (item.type === "oauth" && typeof item.id === "string" && item.id.trim()) {
      const provider = item.id.trim();
      options.push({
        title: format_provider_label(provider),
        value: `oauth:${provider}`,
        description: `Sign in with ${format_provider_label(provider)} OAuth`,
      });
    }
  }
  return options;
}

async function load_auth_options(federation_url: string): Promise<AuthOption[]> {
  const embassy = new Embassy({ federation_url });
  return map_providers_to_options(await embassy.user.account.providers());
}

async function prompt_auth_method(federation_url: string): Promise<EmbassyAuthMethod | null> {
  const auth_options = await load_auth_options(federation_url);
  if (auth_options.length === 0) {
    emitCliBlock({
      tone: "warning",
      title: "No sign-in methods",
      note: "This Federation has no enabled user auth providers.",
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
  })) as { method?: EmbassyAuthMethod };
  return response.method ?? null;
}

async function email_login(input: EmbassyLoginInput): Promise<EmbassyUserSession | null> {
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
  const email = read_string(response.email);
  const password = String(response.password || "");
  if (!email || !email.includes("@") || !password) return null;

  const embassy = new Embassy({ federation_url: input.federation_url });
  const result = await embassy.user.account.login({
    provider: "email",
    client_type: "cli",
    bureau_id: input.bureau_id,
    input: { email, password },
  });
  const done = read_done_login_result(result, "email login");
  return await build_verified_user_session({
    ...input,
    user_token: done.user_token,
    user_id: done.user_id,
    user_label: done.email || email,
  });
}

async function email_register(input: EmbassyLoginInput): Promise<EmbassyUserSession | null> {
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
  const email = read_string(response.email);
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
    note: "Open your verification email, or paste its verification token below.",
  });

  const verify_response = (await prompts({
    type: "text",
    name: "verification_token",
    message: "verification token",
  })) as { verification_token?: string };
  const verification_token = read_string(verify_response.verification_token);
  if (!verification_token) return null;

  const verified = await accounts.action("verify-email").invoke<VerifyResult>({
    token: verification_token,
    bureau_id: input.bureau_id,
  });
  if (verified.error || !verified.success) throw new Error(verified.error || "verification failed");
  const result = await embassy.user.account.login({
    provider: "email", bureau_id: input.bureau_id, client_type: "cli", input: { email, password },
  });
  const done = read_done_login_result(result, "verified email login");
  return await build_verified_user_session({
    ...input, user_token: done.user_token, user_id: done.user_id || registered.user_id, user_label: email,
  });
}

async function oauth_auth(
  input: EmbassyLoginInput,
  provider: string,
): Promise<EmbassyUserSession | null> {
  if (!can_open_system_browser()) throw new Error("OAuth sign-in requires a local system browser. Remote or headless CLI sessions are not supported.");
  const embassy = new Embassy({ federation_url: input.federation_url });
  const callback = await create_loopback_login_callback(180_000);
  let cancelled = false;
  const cancel = () => { cancelled = true; callback.close(); };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await embassy.user.account.login({
      provider, client_type: "cli", bureau_id: input.bureau_id,
      redirect_uri: callback.redirect_uri, state: callback.state,
      code_challenge: callback.code_challenge, code_challenge_method: "S256",
      on_authorize: async (authorization_url) => {
        if (!open_system_browser(authorization_url)) throw new Error("Unable to open the local system browser for OAuth sign-in.");
        emitCliBlock({ tone: "info", title: `OAuth: ${format_provider_label(provider)}`,
          summary: "Complete sign-in in your browser. This terminal will sign in automatically." });
        // 这里只等待本机接收器；远端 status 不能替代浏览器返回授权码。
        while (!callback.authorization_code) {
          if (cancelled) throw new Error("Sign-in cancelled");
          if (callback.error) throw callback.error;
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (cancelled) throw new Error("Sign-in cancelled");
        return { authorization_code: callback.authorization_code, code_verifier: callback.code_verifier };
      },
    });
    if (cancelled) throw new Error("Sign-in cancelled");
    const done = read_done_login_result(result, "OAuth");
    const session = await build_verified_user_session({ ...input, user_token: done.user_token,
      user_id: done.user_id, user_label: done.email || `${provider}:${done.user_id || ""}` });
    if (cancelled) throw new Error("Sign-in cancelled");
    return session;
  } finally {
    callback.close();
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

async function input_auth(
  input: EmbassyLoginInput,
  provider: string,
): Promise<EmbassyUserSession | null> {
  const embassy = new Embassy({ federation_url: input.federation_url });
  const result = await embassy.user.account.login({
    provider,
    client_type: "cli",
    bureau_id: input.bureau_id,
  });
  const done = read_done_login_result(result, "login");
  return await build_verified_user_session({
    ...input,
    user_token: done.user_token,
    user_id: done.user_id,
    user_label: done.email || done.user_id || provider,
  });
}

function read_done_login_result(
  result: EmbassyAccountLoginResult,
  operation: string,
): EmbassyAccountDoneResult & { user_token: string } {
  if (result.error) throw new Error(result.error);
  if (result.status !== "done" || !result.user_token) {
    throw new Error(`${operation} failed: no user token`);
  }
  return result as EmbassyAccountDoneResult & { user_token: string };
}

function build_user_session(input: EmbassyLoginInput & {
  user_token: string;
  user_id?: string;
  user_label?: string;
}): EmbassyUserSession {
  return {
    federation_url: input.federation_url,
    bureau_id: input.bureau_id,
    user_token: input.user_token,
    user_id: read_string(input.user_id) || undefined,
    user_label: read_string(input.user_label) || undefined,
    updated_at: new Date().toISOString(),
  };
}

async function build_verified_user_session(input: EmbassyLoginInput & {
  user_token: string;
  user_id?: string;
  user_label?: string;
}): Promise<EmbassyUserSession> {
  const verified = await read_user_session_from_token(input);
  return build_user_session({
    ...input,
    bureau_id: verified.bureau_id,
    user_id: verified.user_id || input.user_id,
    user_label: verified.user_label || input.user_label,
  });
}

async function read_user_session_from_token(input: EmbassyLoginInput & {
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
  const result = await embassy.user.current();
  const bureau_id = typeof result.user.bureau_id === "string"
    ? result.user.bureau_id
    : "";
  const user_id = read_string(result.user.user_id);
  if (!bureau_id) {
    throw new Error("Federation user token resolved without a bureau_id.");
  }
  const email = read_string(result.profile?.email);
  const display_name = read_string(result.profile?.display_name);
  return {
    bureau_id,
    user_id: user_id || undefined,
    user_label: email || display_name || user_id || undefined,
  };
}

function format_provider_label(provider: string): string {
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
 * 执行 Embassy 用户登录。
 */
export async function perform_embassy_user_login(
  input: EmbassyLoginInput,
): Promise<EmbassyUserSession | null> {
  if (typeof input.bureau_id !== "string" || input.bureau_id.length === 0) {
    throw new TypeError("bureau_id is required");
  }
  const method = await prompt_auth_method(input.federation_url);
  if (!method) return null;
  if (method.startsWith("oauth:")) {
    return await oauth_auth(input, method.slice("oauth:".length));
  }
  if (method.startsWith("input:")) {
    return await input_auth(input, method.slice("input:".length));
  }
  if (method === "register") {
    return await email_register(input);
  }
  return await email_login(input);
}

/**
 * Accounts 服务 OAuth 工具模块。
 *
 * 负责：
 * - provider 配置读取
 * - 授权跳转 URL 构造
 * - GitHub / Google / WeChat 用户资料解析
 */

import type { BetterAuthOptions } from "better-auth";

/**
 * OAuth provider 标识。
 */
export type OAuthProviderId = "github" | "google" | "wechat";

/**
 * 单个 OAuth provider 的运行时配置。
 */
export interface OAuthProviderConfig {
  /**
   * provider 标识。
   */
  id: OAuthProviderId;

  /**
   * OAuth client id。
   */
  client_id: string;

  /**
   * OAuth client secret。
   */
  client_secret: string;
}

/**
 * OAuth provider 返回的用户资料快照。
 */
export interface OAuthProviderProfile {
  /**
   * provider 标识。
   */
  provider: OAuthProviderId;

  /**
   * provider 侧用户唯一 ID。
   */
  provider_user_id: string;

  /**
   * provider 侧邮箱。
   */
  email: string;

  /**
   * provider 邮箱是否已验证。
   */
  email_verified: boolean;

  /**
   * provider 登录名。
   */
  login: string;

  /**
   * provider 展示名。
   */
  display_name: string;

  /**
   * provider 头像 URL。
   */
  avatar_url: string;

  /**
   * provider 个人主页 URL。
   */
  profile_url: string;

  /**
   * provider 原始响应 JSON。
   */
  raw_json: string;
}

/**
 * 当前仓库支持的 OAuth provider 列表。
 */
export const OAUTH_PROVIDER_IDS: readonly OAuthProviderId[] = ["github", "google", "wechat"];

/**
 * 读取 OAuth provider 标识。
 */
export function readOAuthProviderId(value: string | null | undefined): OAuthProviderId | undefined {
  if (value === "github" || value === "google" || value === "wechat") return value;
  return undefined;
}

/**
 * 读取 OAuth provider 配置。
 */
export function readOAuthProviderConfig(
  id: OAuthProviderId,
  client_id: string | undefined,
  client_secret: string | undefined,
): OAuthProviderConfig | undefined {
  if (!client_id || !client_secret) return undefined;
  return { id, client_id, client_secret };
}

/**
 * 构造 OAuth provider 授权跳转 URL。
 */
export function buildOAuthAuthorizeURL(config: OAuthProviderConfig, callbackURL: string, state: string): string {
  if (config.id === "github") {
    return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.client_id)}&redirect_uri=${encodeURIComponent(callbackURL)}&state=${encodeURIComponent(state)}&scope=read:user,user:email`;
  }

  if (config.id === "wechat") {
    const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
    url.searchParams.set("appid", config.client_id);
    url.searchParams.set("redirect_uri", callbackURL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "snsapi_login");
    url.searchParams.set("state", state);
    url.searchParams.set("lang", "cn");
    url.hash = "wechat_redirect";
    return url.toString();
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(config.client_id)}&redirect_uri=${encodeURIComponent(callbackURL)}&state=${encodeURIComponent(state)}&response_type=code&scope=${encodeURIComponent("openid email profile")}`;
}

/**
 * 解析第三方用户资料。
 */
export async function resolveOAuthProfile(
  provider: OAuthProviderId,
  config: OAuthProviderConfig | undefined,
  code: string,
  callbackURL: string,
): Promise<OAuthProviderProfile> {
  if (provider === "github") {
    return resolveGitHubProfile(config, code, callbackURL);
  }
  if (provider === "wechat") {
    return resolveWeChatProfile(config, code);
  }
  return resolveGoogleProfile(config, code, callbackURL);
}

/**
 * 构建 better-auth 社交 provider 配置。
 */
export function buildSocialProviders(
  getEnv?: (key: string) => string | undefined,
  provider_ids: readonly OAuthProviderId[] = OAUTH_PROVIDER_IDS,
): BetterAuthOptions["socialProviders"] {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};

  const ghId = getEnv?.("GITHUB_CLIENT_ID");
  const ghSecret = getEnv?.("GITHUB_CLIENT_SECRET");
  if (provider_ids.includes("github") && ghId && ghSecret) {
    providers.github = { clientId: ghId, clientSecret: ghSecret };
  }

  const googleId = getEnv?.("GOOGLE_CLIENT_ID");
  const googleSecret = getEnv?.("GOOGLE_CLIENT_SECRET");
  if (provider_ids.includes("google") && googleId && googleSecret) {
    providers.google = { clientId: googleId, clientSecret: googleSecret };
  }

  const wechatId = getEnv?.("WECHAT_CLIENT_ID");
  const wechatSecret = getEnv?.("WECHAT_CLIENT_SECRET");
  if (provider_ids.includes("wechat") && wechatId && wechatSecret) {
    providers.wechat = { clientId: wechatId, clientSecret: wechatSecret };
  }

  return providers;
}

/**
 * 解析 GitHub 用户资料。
 */
async function resolveGitHubProfile(
  config: OAuthProviderConfig | undefined,
  code: string,
  callbackURL: string,
): Promise<OAuthProviderProfile> {
  if (!config) throw new Error("GitHub OAuth is not configured");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      redirect_uri: callbackURL,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
  if (tokenData.error || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Failed to get GitHub access token");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "downcity" },
  });
  const ghUser = await userRes.json() as {
    id?: number;
    email?: string | null;
    login?: string | null;
    name?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
  };
  if (!ghUser.id) throw new Error("Failed to get GitHub user");

  let email = typeof ghUser.email === "string" ? ghUser.email : "";
  let emailVerified = false;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "downcity" },
    });
    const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified?: boolean }>;
    const primary = emails.find((item) => item.primary) ?? emails[0];
    email = primary?.email ?? `github_${ghUser.id}@github.user`;
    emailVerified = Boolean(primary?.verified);
  }

  return {
    provider: "github",
    provider_user_id: String(ghUser.id),
    email,
    email_verified: emailVerified,
    login: String(ghUser.login ?? ""),
    display_name: String(ghUser.name ?? ghUser.login ?? email.split("@")[0] ?? ""),
    avatar_url: String(ghUser.avatar_url ?? ""),
    profile_url: String(ghUser.html_url ?? ""),
    raw_json: JSON.stringify({ user: ghUser }),
  };
}

/**
 * 解析 Google 用户资料。
 */
async function resolveGoogleProfile(
  config: OAuthProviderConfig | undefined,
  code: string,
  callbackURL: string,
): Promise<OAuthProviderProfile> {
  if (!config) throw new Error("Google OAuth is not configured");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackURL,
    }),
  });
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (tokenData.error || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Failed to get Google access token");
  }

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const googleUser = await userRes.json() as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    profile?: string;
  };
  if (!googleUser.sub) throw new Error("Failed to get Google user");

  const email = googleUser.email ?? `google_${googleUser.sub}@google.user`;
  return {
    provider: "google",
    provider_user_id: String(googleUser.sub),
    email,
    email_verified: Boolean(googleUser.email_verified),
    login: "",
    display_name: String(googleUser.name ?? email.split("@")[0] ?? ""),
    avatar_url: String(googleUser.picture ?? ""),
    profile_url: String(googleUser.profile ?? ""),
    raw_json: JSON.stringify({ user: googleUser }),
  };
}

/**
 * 解析 WeChat 网站应用用户资料。
 */
async function resolveWeChatProfile(
  config: OAuthProviderConfig | undefined,
  code: string,
): Promise<OAuthProviderProfile> {
  if (!config) throw new Error("WeChat OAuth is not configured");

  const tokenRes = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${new URLSearchParams({
    appid: config.client_id,
    secret: config.client_secret,
    code,
    grant_type: "authorization_code",
  }).toString()}`);
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    openid?: string;
    scope?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (tokenData.errcode || !tokenData.access_token || !tokenData.openid) {
    throw new Error(tokenData.errmsg || "Failed to get WeChat access token");
  }

  const userRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?${new URLSearchParams({
    access_token: tokenData.access_token,
    openid: tokenData.openid,
    lang: "zh_CN",
  }).toString()}`);
  const wechatUser = await userRes.json() as {
    openid?: string;
    nickname?: string;
    headimgurl?: string;
    privilege?: string[];
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (wechatUser.errcode || !wechatUser.openid) {
    throw new Error(wechatUser.errmsg || "Failed to get WeChat user");
  }

  const providerUserId = String(wechatUser.unionid ?? wechatUser.openid);
  const email = buildSyntheticOAuthEmail("wechat", providerUserId);
  return {
    provider: "wechat",
    provider_user_id: providerUserId,
    email,
    email_verified: false,
    login: "",
    display_name: String(wechatUser.nickname ?? email.split("@")[0] ?? ""),
    avatar_url: String(wechatUser.headimgurl ?? ""),
    profile_url: "",
    raw_json: JSON.stringify({
      token: tokenData,
      user: wechatUser,
    }),
  };
}

/**
 * 为不返回邮箱的 OAuth provider 生成内部占位邮箱。
 */
function buildSyntheticOAuthEmail(provider: OAuthProviderId, providerUserId: string): string {
  return `${provider}_${providerUserId}@${provider}.user`;
}

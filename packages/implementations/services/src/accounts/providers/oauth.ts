/**
 * OAuth accounts provider 工厂。
 *
 * 关键说明（中文）
 * - GitHub / Google / WeChat 都只是 AccountsService 的 provider。
 * - provider 只声明 env 与 OAuth 配置读取逻辑，回调和用户落库由 AccountsService 统一处理。
 */

import { readOAuthProviderConfig, type OAuthProviderId } from "../oauth.js";
import type { AccountsOAuthProvider, OAuthAccountsProviderOptions } from "../types.js";

const OAUTH_LABELS: Record<OAuthProviderId, string> = {
  github: "GitHub",
  google: "Google",
  wechat: "WeChat",
};

const OAUTH_ENV_KEYS: Record<OAuthProviderId, { client_id: string; client_secret: string }> = {
  github: {
    client_id: "GITHUB_CLIENT_ID",
    client_secret: "GITHUB_CLIENT_SECRET",
  },
  google: {
    client_id: "GOOGLE_CLIENT_ID",
    client_secret: "GOOGLE_CLIENT_SECRET",
  },
  wechat: {
    client_id: "WECHAT_CLIENT_ID",
    client_secret: "WECHAT_CLIENT_SECRET",
  },
};

/**
 * 创建 OAuth accounts provider。
 */
export function oauthAccountsProvider(
  id: OAuthProviderId,
  options: OAuthAccountsProviderOptions = {},
): AccountsOAuthProvider {
  const label = options.label?.trim() || OAUTH_LABELS[id];
  const keys = OAUTH_ENV_KEYS[id];
  return {
    id,
    label,
    type: "oauth",
    env: [
      { key: keys.client_id, description: `${label} OAuth Client ID`, required: true },
      { key: keys.client_secret, description: `${label} OAuth Client Secret`, required: true },
    ],
    method(ctx) {
      const enabled = Boolean(readOAuthProviderConfig(
        id,
        options.client_id ?? ctx.env(keys.client_id),
        options.client_secret ?? ctx.env(keys.client_secret),
      ));
      return {
        id,
        type: "oauth",
        enabled,
        label,
        inputs: [],
        reason: enabled ? undefined : "not_configured",
      };
    },
    config(ctx) {
      return readOAuthProviderConfig(
        id,
        options.client_id ?? ctx.env(keys.client_id),
        options.client_secret ?? ctx.env(keys.client_secret),
      );
    },
  };
}

/**
 * 创建 GitHub accounts provider。
 */
export function githubAccountsProvider(options: OAuthAccountsProviderOptions = {}): AccountsOAuthProvider {
  return oauthAccountsProvider("github", options);
}

/**
 * 创建 Google accounts provider。
 */
export function googleAccountsProvider(options: OAuthAccountsProviderOptions = {}): AccountsOAuthProvider {
  return oauthAccountsProvider("google", options);
}

/**
 * 创建 WeChat accounts provider。
 */
export function wechatAccountsProvider(options: OAuthAccountsProviderOptions = {}): AccountsOAuthProvider {
  return oauthAccountsProvider("wechat", options);
}

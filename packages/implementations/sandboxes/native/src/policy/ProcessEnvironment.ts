/**
 * 原生 Sandbox 子进程环境清理。
 *
 * 默认移除按名称识别的凭证和认证变量，保留 PATH、HOME、语言与构建配置。
 * 只有宿主 Provider 配置可以精确放行变量；始终移除 Downcity 内部认证令牌。
 * 名称过滤不是秘密检测，也不能阻止从宿主 HOME 或 login shell 配置重新加载凭证。
 */

/** 判断变量名称是否表示凭证；不检查、记录或返回变量值。 */
function is_credential_key(key: string): boolean {
  return /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_KEY|API_KEY|ACCESS_KEY)(?:_|$)/i.test(key)
    || /^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|GITHUB_PAT|GH_ENTERPRISE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CLIENT_CERTIFICATE_PATH)$/i.test(key);
}

/** 复制环境快照并移除未获宿主明确授权的凭证变量。 */
export function sanitize_process_environment(
  env: Readonly<Record<string, string>>,
  allowed_credential_env: readonly string[] = [],
): Record<string, string> {
  const allowed_keys = new Set(allowed_credential_env);
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => {
    if (typeof value !== "string") return false;
    if (/^DC_(?:AUTH|AGENT)_TOKEN$/i.test(key)) return false;
    return !is_credential_key(key) || allowed_keys.has(key);
  }));
}

/**
 * Windows SRT 子进程环境收敛。
 *
 * 关键点（中文）
 * - 只导出 Shell 策略允许的变量与 DC_ 运行时变量。
 * - SRT 自己生成的网络代理、证书和 Git 变量不允许被宿主覆盖。
 * - 环境通过 srt-win 的 --env argv 传递，不拼接进 cmd 命令文本。
 */

import type { SandboxSpawnRequest } from "@downcity/workspace/protocol";

const RESERVED_ENV_NAMES = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "all_proxy",
  "NO_PROXY", "no_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO", "CARGO_HTTP_CAINFO",
]);

function read_windows_env_value(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const key = Object.keys(env).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function is_reserved_env_name(name: string): boolean {
  return RESERVED_ENV_NAMES.has(name) || name.toUpperCase().startsWith("GIT_CONFIG_");
}

/** 构造允许进入 Windows SRT 子进程的环境变量。 */
export function build_windows_srt_env(
  request: SandboxSpawnRequest,
): Record<string, string> {
  const result = new Map<string, { name: string; value: string }>();
  const add_value = (name: string, value: string | undefined): void => {
    const normalized_name = String(name || "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized_name)) return;
    if (is_reserved_env_name(normalized_name)) return;
    if (typeof value !== "string" || value.includes("\0")) return;
    result.set(normalized_name.toLowerCase(), { name: normalized_name, value });
  };

  for (const name of request.policy.env_allowlist) {
    add_value(name, read_windows_env_value(request.base_env, name));
  }
  for (const [name, value] of Object.entries(request.base_env)) {
    if (name.startsWith("DC_")) add_value(name, value);
  }

  add_value("HOME", request.policy.home_dir);
  add_value("TMP", request.policy.tmp_dir);
  add_value("TEMP", request.policy.tmp_dir);
  add_value("DC_SANDBOX", "1");
  add_value("DC_SANDBOX_ALPHA", "1");
  add_value("DC_SANDBOX_DIR", request.policy.sandbox_dir);
  add_value("DC_SANDBOX_HOME", request.policy.home_dir);
  add_value("DC_SANDBOX_TMP", request.policy.tmp_dir);
  add_value("DC_SANDBOX_CACHE", request.policy.cache_dir);
  add_value("SHELL", request.shell_path);

  return Object.fromEntries(
    [...result.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((item) => [item.name, item.value]),
  );
}

/**
 * 向 SRT 公开 spawn descriptor 注入 Downcity 白名单环境。
 *
 * 关键点（中文）：srt-win 的 `--env KEY=VALUE` 是公开 CLI 契约；这里只操作 `--` 前的 broker 参数。
 */
export function inject_windows_srt_env(
  argv: readonly string[],
  allowed_env: Readonly<Record<string, string>>,
): string[] {
  const delimiter_index = argv.indexOf("--");
  if (delimiter_index < 2) {
    throw new Error("Anthropic SRT returned an invalid Windows spawn descriptor.");
  }

  const replacement_names = new Set(
    Object.keys(allowed_env).map((name) => name.toLowerCase()),
  );
  const broker_args: string[] = [];
  for (let index = 0; index < delimiter_index; index += 1) {
    const value = argv[index];
    const next_value = argv[index + 1];
    if (value === "--env" && typeof next_value === "string") {
      const separator_index = next_value.indexOf("=");
      const name = separator_index < 0 ? next_value : next_value.slice(0, separator_index);
      if (replacement_names.has(name.toLowerCase()) && !is_reserved_env_name(name)) {
        index += 1;
        continue;
      }
    }
    broker_args.push(value);
  }

  for (const [name, value] of Object.entries(allowed_env)) {
    broker_args.push("--env", `${name}=${value}`);
  }
  const result = [...broker_args, ...argv.slice(delimiter_index)];
  const command_line_size = result.reduce((size, value) => size + value.length + 3, 0);
  if (command_line_size > 30_000) {
    throw new Error(
      `Windows SRT command line is approximately ${command_line_size} characters and exceeds the safe CreateProcessW budget.`,
    );
  }
  return result;
}

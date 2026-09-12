/**
 * Desktop 出站代理解析。
 *
 * 关键点（中文）
 * - Electron 的 Chromium 侧会自动遵循系统代理，但 Node/插件侧不会，需要显式解析并注入。
 * - 代理优先级：Desktop 显式设置 → 操作系统系统代理 → Global Env 中的通用代理变量。
 * - 系统代理的例外列表会转换成 NO_PROXY 规则，保持与系统行为一致。
 * - 该模块只负责"读"，不负责应用；应用与重连由 Desktop 启动流程负责。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec_file = promisify(execFile);

/** 系统代理读取命令超时，避免 scutil 异常时拖住启动流程。 */
const SCUTIL_TIMEOUT_MS = 3_000;

/** 从 Global Env 读取代理时使用的变量名与优先级。 */
export const GLOBAL_ENV_PROXY_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

/** 从 Global Env 读取 NO_PROXY 时使用的变量名。 */
export const GLOBAL_ENV_NO_PROXY_KEYS = ["NO_PROXY", "no_proxy"] as const;

/**
 * 操作系统当前生效的代理配置。
 */
export interface DesktopSystemProxy {
  /**
   * 可直接交给插件 HTTP 层使用的代理地址。
   *
   * 说明（中文）
   * - 为空字符串表示系统未启用可用代理，或者只启用了本产品不支持的代理类型。
   * - 一定是 `http://` 或 `https://` 开头。
   */
  proxy_url: string;
  /**
   * 由系统例外列表转换出的 NO_PROXY 规则。
   *
   * 说明（中文）
   * - 逗号分隔，例如 `127.0.0.1,*.local`。
   * - 为空字符串表示无例外。
   */
  no_proxy: string;
}

/** 空代理配置，用于统一返回结构。 */
const NO_SYSTEM_PROXY: DesktopSystemProxy = { proxy_url: "", no_proxy: "" };

/**
 * 读取当前操作系统生效的代理。
 *
 * 说明（中文）
 * - macOS 通过 `scutil --proxy` 读取，这是系统代理的权威来源。
 * - 其他平台返回空配置，由 Global Env 机制承担（避免引入未经验证的平台分支）。
 */
export async function read_system_proxy(): Promise<DesktopSystemProxy> {
  if (process.platform !== "darwin") return NO_SYSTEM_PROXY;
  try {
    const { stdout } = await exec_file("scutil", ["--proxy"], {
      timeout: SCUTIL_TIMEOUT_MS,
    });
    return parse_scutil_proxy(stdout);
  } catch {
    // 说明（中文）：系统代理读取失败不应影响 Desktop 启动，降级为直连。
    return NO_SYSTEM_PROXY;
  }
}

/**
 * 解析 scutil 输出的代理字典。
 *
 * 关键点（中文）
 * - 优先使用 HTTPS 代理，因为渠道请求基本都走 HTTPS。
 * - 只启用 SOCKS 时无法映射到插件代理（undici 不支持 socks），返回空并保持直连。
 * - 启用 PAC 时无法在无浏览器环境中求值，返回空。
 */
export function parse_scutil_proxy(output: string): DesktopSystemProxy {
  const values = new Map<string, string>();
  for (const line of String(output || "").split("\n")) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/u.exec(line);
    if (match) values.set(match[1], match[2]);
  }

  const read_number = (key: string): number => {
    const parsed = Number(values.get(key));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const read_text = (key: string): string => String(values.get(key) || "").trim();
  const to_url = (host: string, port: number): string => {
    if (!host || port <= 0) return "";
    return `http://${host}:${port}`;
  };

  const proxy_url = read_number("HTTPSEnable")
    ? to_url(read_text("HTTPSProxy"), read_number("HTTPSPort"))
    : read_number("HTTPEnable")
      ? to_url(read_text("HTTPProxy"), read_number("HTTPPort"))
      : "";

  return {
    proxy_url,
    no_proxy: parse_scutil_exceptions(String(output || "")),
  };
}

/**
 * 解析 scutil 输出中的例外列表。
 *
 * 说明（中文）
 * - 例外列表位于 `ExceptionsList : <array> { ... }` 块内，条目形如 `0 : 127.0.0.1`。
 * - `<local>` 是系统占位符号，不是可用主机名，直接忽略。
 */
export function parse_scutil_exceptions(output: string): string {
  const lines = String(output || "").split("\n");
  const start_index = lines.findIndex((line) => /ExceptionsList\s*:\s*<array>/u.test(line));
  if (start_index < 0) return "";
  const rules: string[] = [];
  for (const line of lines.slice(start_index + 1)) {
    if (/^\s*\}/u.test(line)) break;
    const match = /^\s*\d+\s*:\s*(.+?)\s*$/u.exec(line);
    const rule = match ? match[1].trim() : "";
    if (!rule || rule === "<local>") continue;
    rules.push(rule);
  }
  return rules.join(",");
}

/** 从 Global Env 快照中读取通用代理变量。 */
export function read_global_env_proxy_url(global_env: Record<string, string>): string {
  for (const key of GLOBAL_ENV_PROXY_KEYS) {
    const value = String(global_env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

/** 从 Global Env 快照中读取 NO_PROXY 规则。 */
export function read_global_env_no_proxy(global_env: Record<string, string>): string {
  for (const key of GLOBAL_ENV_NO_PROXY_KEYS) {
    const value = String(global_env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

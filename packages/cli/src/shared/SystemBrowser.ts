/**
 * 系统浏览器能力模块。
 *
 * 关键点（中文）
 * - 统一处理 macOS、Windows 与 Linux 的默认浏览器启动命令。
 * - SSH、CI 与 Linux 无图形会话中不尝试启动浏览器，避免 VPS 上出现假成功。
 * - 调用方必须独立展示目标 URL，不能把命令退出状态当作用户已看到页面。
 */

import { spawnSync } from "node:child_process";

/**
 * 判断当前进程是否具备可用的本地图形浏览器环境。
 *
 * @param env 当前进程环境变量，允许测试或调用方显式注入。
 * @param platform 当前操作系统平台。
 */
export function can_open_system_browser(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (is_truthy_env(env.CI)) return false;
  if (has_ssh_session(env)) return false;
  if (platform !== "linux") return true;
  return Boolean(read_env(env.DISPLAY) || read_env(env.WAYLAND_DISPLAY));
}

/**
 * 尝试使用系统默认浏览器打开 URL。
 *
 * @returns 仅表示启动命令成功，不表示用户已经完成页面操作。
 */
export function open_system_browser(url: string): boolean {
  if (!can_open_system_browser()) return false;

  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", url]
    : [url];

  try {
    const result = spawnSync(command, args, {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 判断当前环境是否由 SSH 会话启动。
 */
function has_ssh_session(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    read_env(env.SSH_CONNECTION) ||
    read_env(env.SSH_CLIENT) ||
    read_env(env.SSH_TTY),
  );
}

/**
 * 读取并归一化环境变量文本。
 */
function read_env(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 判断环境变量是否显式启用。
 */
function is_truthy_env(value: string | undefined): boolean {
  const normalized = read_env(value).toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

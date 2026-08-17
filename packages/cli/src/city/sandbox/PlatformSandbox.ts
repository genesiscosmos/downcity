/**
 * Downcity CLI 平台 Sandbox 装配根。
 *
 * 关键点（中文）
 * - 只有 CLI 可根据当前宿主自动选择平台实现。
 * - 动态导入严格收敛在此模块，使非当前系统的 optional package 不会被解析或安装。
 * - Windows 默认保留 MXC；只有用户显式设置 DC_WINDOWS_SANDBOX=srt 时才启用 SRT Alpha。
 */

import type { ShellSandboxAdapter } from "@downcity/workspace";

/** Windows CLI 当前支持的 sandbox backend 选择。 */
export type WindowsSandboxSelection = "mxc" | "srt";

/** 解析 Windows sandbox 显式选择；未配置时继续使用 MXC。 */
export function resolve_windows_sandbox_selection(
  env: NodeJS.ProcessEnv = process.env,
): WindowsSandboxSelection {
  const selection = String(env.DC_WINDOWS_SANDBOX || "mxc").trim().toLowerCase();
  if (selection === "mxc" || selection === "srt") return selection;
  throw new Error(
    `Unsupported DC_WINDOWS_SANDBOX value: ${selection}. Expected mxc or srt.`,
  );
}

/** 为当前 CLI 宿主创建唯一的平台 Sandbox Adapter。 */
export async function create_platform_sandbox(): Promise<ShellSandboxAdapter> {
  if (process.platform === "darwin") {
    const { MacOsSeatbeltSandbox } = await import("@downcity/sandbox-macos");
    return new MacOsSeatbeltSandbox();
  }
  if (process.platform === "linux") {
    const { LinuxBubblewrapSandbox } = await import("@downcity/sandbox-linux");
    return new LinuxBubblewrapSandbox();
  }
  if (process.platform === "win32") {
    if (resolve_windows_sandbox_selection() === "srt") {
      const { WindowsSrtSandbox } = await import("@downcity/sandbox-windows-srt");
      return new WindowsSrtSandbox();
    }
    const { WindowsMxcSandbox } = await import("@downcity/sandbox-windows-mxc");
    return new WindowsMxcSandbox();
  }
  throw new Error(`Downcity shell sandbox does not support platform: ${process.platform}`);
}

/**
 * Desktop 平台 Sandbox 装配入口。
 *
 * Electron main 拥有宿主平台选择；本模块不会进入 Agent、City 或本地数据包。
 */

import type { ShellSandboxAdapter } from "@downcity/shell";

/** 为当前 Desktop 进程创建平台对应的 Sandbox Adapter。 */
export async function create_desktop_platform_sandbox(): Promise<ShellSandboxAdapter> {
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
  throw new Error(`Downcity Desktop does not support platform: ${process.platform}`);
}

/** 解析 Windows Sandbox 选择；默认使用 MXC。 */
function resolve_windows_sandbox_selection(): "mxc" | "srt" {
  const selection = String(process.env.DC_WINDOWS_SANDBOX || "mxc").trim().toLowerCase();
  if (selection === "mxc" || selection === "srt") return selection;
  throw new Error(
    `Unsupported DC_WINDOWS_SANDBOX value: ${selection}. Expected mxc or srt.`,
  );
}

/**
 * Anthropic Windows SRT 安装、卸载与宿主预检。
 *
 * 关键点（中文）：普通命令执行绝不自动触发 UAC，安装只能由用户显式调用。
 */

import {
  VENDORED_SRT_WIN_EXE,
  checkWindowsDependenciesAsync,
  installWindowsSandboxAsync,
  resolveSrtWin,
  uninstallWindowsSandbox,
} from "@anthropic-ai/sandbox-runtime";
import type { SandboxPreflightResult } from "@downcity/workspace/protocol";
import {
  WINDOWS_SRT_BACKEND,
  WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE,
  WINDOWS_SRT_DEFAULT_SUBLAYER_GUID,
  WINDOWS_SRT_DEFAULT_USER,
} from "./WindowsSrtConstants.js";
import type {
  WindowsSrtInstallOptions,
  WindowsSrtSandboxOptions,
} from "./types/WindowsSrt.js";

function resolve_options(options: WindowsSrtSandboxOptions): Required<WindowsSrtSandboxOptions> {
  return {
    sandbox_user: options.sandbox_user || WINDOWS_SRT_DEFAULT_USER,
    sublayer_guid: options.sublayer_guid || WINDOWS_SRT_DEFAULT_SUBLAYER_GUID,
    proxy_port_range: options.proxy_port_range || WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE,
  };
}

/** 检查 Downcity 专属 SRT 用户、helper 与 WFP filter 是否可用。 */
export async function inspect_windows_srt_support(
  options: WindowsSrtSandboxOptions = {},
): Promise<SandboxPreflightResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      platform: process.platform,
      backend: WINDOWS_SRT_BACKEND,
      issues: [{
        code: "unsupported-platform",
        message: "Anthropic SRT Windows sandbox requires a win32 host.",
        fixes: ["Use @downcity/sandbox-windows-srt only on Windows."],
      }],
    };
  }

  const resolved = resolve_options(options);
  const srt_win = resolveSrtWin({ path: VENDORED_SRT_WIN_EXE });
  const support = await checkWindowsDependenciesAsync({
    sublayerGuid: resolved.sublayer_guid,
    srtWin: srt_win,
  });
  const fixes = ["Run `npx @downcity/sandbox-windows-srt setup` or call install_windows_srt()."];
  return {
    ok: support.errors.length === 0,
    platform: process.platform,
    backend: WINDOWS_SRT_BACKEND,
    issues: support.errors.map((message) => ({
      code: "sandbox-runtime-unavailable" as const,
      message,
      fixes,
    })),
  };
}

/** 显式安装 Downcity 专属 Windows SRT 用户与 WFP filter。 */
export async function install_windows_srt(
  options: WindowsSrtInstallOptions = {},
): ReturnType<typeof installWindowsSandboxAsync> {
  const resolved = resolve_options(options);
  return await installWindowsSandboxAsync({
    sandboxUser: resolved.sandbox_user,
    sublayerGuid: resolved.sublayer_guid,
    proxyPortRange: [...resolved.proxy_port_range],
    force: options.force,
    srtWin: resolveSrtWin({ path: VENDORED_SRT_WIN_EXE }),
  });
}

/** 显式卸载 Downcity 专属 Windows SRT 用户与 WFP filter。 */
export function uninstall_windows_srt(
  options: WindowsSrtSandboxOptions = {},
): ReturnType<typeof uninstallWindowsSandbox> {
  const resolved = resolve_options(options);
  return uninstallWindowsSandbox({
    sublayerGuid: resolved.sublayer_guid,
    srtWin: resolveSrtWin({ path: VENDORED_SRT_WIN_EXE }),
  });
}

/**
 * Downcity SandboxPolicy 到 Anthropic SRT 配置的映射。
 *
 * 关键点（中文）：workspace 写边界仍由 Shell 核心决定，adapter 只能消费已解析路径。
 */

import {
  VENDORED_SRT_WIN_EXE,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import type { SandboxSpawnRequest } from "@downcity/workspace/protocol";
import {
  WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE,
  WINDOWS_SRT_DEFAULT_SUBLAYER_GUID,
  WINDOWS_SRT_DEFAULT_USER,
} from "./WindowsSrtConstants.js";
import type { WindowsSrtSandboxOptions } from "./types/WindowsSrt.js";

/** 构造单个 Windows SRT 安全域使用的完整配置。 */
export function build_windows_srt_config(
  request: SandboxSpawnRequest,
  options: WindowsSrtSandboxOptions = {},
): SandboxRuntimeConfig {
  return {
    filesystem: {
      denyRead: [],
      // 关键点（中文）
      // - SRT Windows 默认允许读取系统可读目录，allowWrite 已包含 workspace 读取权限。
      // - allowRead 会直接向目标写入 NTFS ACL，只能用于宿主显式批准的私有工具目录。
      allowRead: [...request.policy.host_read_only_paths],
      allowWrite: [...request.policy.read_write_paths],
      denyWrite: [],
    },
    network: {
      allowedDomains: request.policy.network_mode === "full" ? ["*"] : [],
      deniedDomains: [],
    },
    windows: {
      sandboxUser: options.sandbox_user || WINDOWS_SRT_DEFAULT_USER,
      sublayerGuid: options.sublayer_guid || WINDOWS_SRT_DEFAULT_SUBLAYER_GUID,
      proxyPortRange: options.proxy_port_range
        ? [...options.proxy_port_range]
        : [...WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE],
      srtWin: { path: VENDORED_SRT_WIN_EXE },
    },
    git: {
      safeDirectories: [request.policy.root_path],
    },
  };
}

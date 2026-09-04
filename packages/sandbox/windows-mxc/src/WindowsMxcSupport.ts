/**
 * Windows MXC Development 后端能力探测。
 *
 * 关键点（中文）
 * - Downcity 仅在 Windows 11 24H2（build 26100）及以上启用该后端。
 * - MXC 必须同时报告 processcontainer 和有效隔离层级，否则按不可用处理。
 * - 探测失败时 fail closed，不允许 Safe Sandbox 静默退化为宿主执行。
 */

import os from "node:os";
import {
  getPlatformSupport,
  type PlatformSupport,
} from "@microsoft/mxc-sdk";
import type { WindowsMxcSupport } from "@/types/WindowsMxc.js";

/** Downcity Windows Development 支持的最低 Windows build。 */
export const WINDOWS_MXC_MINIMUM_BUILD = 26_100;

/** 从 `os.release()` 结果解析 Windows build number。 */
export function parse_windows_build(release: string): number | null {
  const parts = release.split(".");
  if (parts.length < 3) return null;
  const build = Number.parseInt(parts[2] || "", 10);
  return Number.isInteger(build) && build > 0 ? build : null;
}

/**
 * 根据 Windows build 与 MXC probe 生成统一支持结论。
 */
export function evaluate_windows_mxc_support(params: {
  /** 当前宿主 Windows build number。 */
  windows_build: number | null;
  /** MXC SDK 返回的平台能力。 */
  platform_support: PlatformSupport;
}): WindowsMxcSupport {
  if (
    params.windows_build === null
    || params.windows_build < WINDOWS_MXC_MINIMUM_BUILD
  ) {
    return {
      supported: false,
      windows_build: params.windows_build,
      warnings: [],
      reason: `Windows MXC development sandbox requires Windows 11 24H2 build ${WINDOWS_MXC_MINIMUM_BUILD} or newer.`,
    };
  }
  if (
    !params.platform_support.isSupported
    || !params.platform_support.availableMethods.includes("processcontainer")
  ) {
    return {
      supported: false,
      windows_build: params.windows_build,
      warnings: params.platform_support.isolationWarnings || [],
      reason: params.platform_support.reason || "Microsoft MXC processcontainer is unavailable on this host.",
    };
  }
  if (!params.platform_support.isolationTier) {
    return {
      supported: false,
      windows_build: params.windows_build,
      warnings: params.platform_support.isolationWarnings || [],
      reason: "Microsoft MXC could not determine a usable Windows isolation tier.",
    };
  }
  return {
    supported: true,
    windows_build: params.windows_build,
    isolation_tier: params.platform_support.isolationTier,
    warnings: params.platform_support.isolationWarnings || [],
  };
}

/** 探测当前宿主的 Windows MXC 支持状态。 */
export function inspect_windows_mxc_support(): WindowsMxcSupport {
  if (process.platform !== "win32") {
    return {
      supported: false,
      windows_build: null,
      warnings: [],
      reason: "Microsoft MXC Windows backend is only available on win32 hosts.",
    };
  }
  return evaluate_windows_mxc_support({
    windows_build: parse_windows_build(os.release()),
    platform_support: getPlatformSupport(),
  });
}

/**
 * Desktop Sandbox Provider 装配入口。
 *
 * 关键点（中文）
 * - Desktop 默认使用宿主 OS 原生隔离，与 CLI 保持同一套围栏语义。
 * - Electron main 为每个 Shell 创建 Provider，City 不理解隔离后端。
 */

import { NativeSandboxProvider } from "@downcity/sandbox-native";

/** 为 Desktop 创建的每个 Shell 提供 Sandbox Provider。 */
export function create_desktop_sandbox_provider(): NativeSandboxProvider {
  return new NativeSandboxProvider();
}

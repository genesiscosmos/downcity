/**
 * Downcity CLI Sandbox Provider 装配根。
 *
 * 关键点（中文）
 * - CLI 默认使用宿主 OS 原生隔离（macOS seatbelt / Linux bubblewrap）：
 *   使用真实工具链，凭证按原生策略清理，SSH 只由 Workspace 显式授权。
 * - 原生隔离需要宿主提供进程启动器，Shell 在构造时自行注入，CLI 不需要传递。
 * - 每个 Shell 在构造时显式接收 Provider，City 不理解隔离后端。
 */

import { NativeSandboxProvider, type NativeSshAccess } from "@downcity/sandbox-native";

/** 为 CLI 创建的每个 Shell 提供 Sandbox Provider。 */
export function create_sandbox_provider(ssh?: NativeSshAccess): NativeSandboxProvider {
  return new NativeSandboxProvider({ ssh });
}

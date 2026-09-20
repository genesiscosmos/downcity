/**
 * Downcity CLI Sandbox Provider 装配根。
 *
 * 关键点（中文）
 * - CLI 默认使用宿主 OS 原生隔离（macOS seatbelt / Linux bubblewrap）：
 *   命令、工具链、node_modules 与凭证全部沿用真实机器，围栏只约束可写范围。
 * - 原生隔离需要宿主提供进程启动器，Shell 在构造时自行注入，CLI 不需要传递。
 * - 每个 Shell 在构造时显式接收 Provider，City 不理解隔离后端。
 */

import { NativeSandboxProvider } from "@downcity/sandbox-native";

/** 为 CLI 创建的每个 Shell 提供 Sandbox Provider。 */
export function create_sandbox_provider(): NativeSandboxProvider {
  return new NativeSandboxProvider();
}

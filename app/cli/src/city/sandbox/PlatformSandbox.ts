/**
 * Downcity CLI Sandbox Provider 装配根。
 *
 * 关键点（中文）
 * - CLI 只装配一个跨平台 microsandbox Provider，不再选择宿主路径权限实现。
 * - 每个 Shell 在构造时显式接收 Provider，City 不理解隔离后端。
 */

import { MicrosandboxProvider } from "@downcity/sandbox-microsandbox";

/** 为 CLI 创建的每个 Shell 提供 Sandbox Provider。 */
export function create_sandbox_provider(): MicrosandboxProvider {
  return new MicrosandboxProvider();
}

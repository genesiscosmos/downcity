/**
 * Desktop Sandbox Provider 装配入口。
 *
 * Electron main 为每个 Shell 创建 Provider，City 不理解隔离后端。
 */

import { MicrosandboxProvider } from "@downcity/sandbox-microsandbox";

/** 为 Desktop 创建的每个 Shell 提供 Sandbox Provider。 */
export function create_desktop_sandbox_provider(): MicrosandboxProvider {
  return new MicrosandboxProvider();
}

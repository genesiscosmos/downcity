/**
 * Agent HTTP 宿主运行时能力类型。
 *
 * 这里只声明 SDK HTTP transport 需要宿主补充的解析能力。
 */

import type { AgentSessionModelResolver } from "@/types/AgentSessionModelResolver.js";

/** Agent HTTP 宿主运行时能力。 */
export interface AgentHttpRuntimeOptions {
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;
}

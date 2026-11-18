/**
 * 冻结 v10 schema、消息 codec 与根门禁的离线桥。
 * v9→v10 历史批次和 v10→v11 源校验使用同一协议，不随正式 SDK 版本变化。
 * 此入口不授予当前宿主就绪状态，不启动 Agent、City 或模型。
 */
import { load_runtime as load_protocol } from "./session-runtime.mjs";

/** 只加载明确的历史协议，防止当前 schema 被误用为旧批次目标。 */
export async function load_runtime() {
  const runtime = await load_protocol(true, "historical-v10");
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 10) throw new Error("v10_tool_runtime_version_mismatch");
  return runtime;
}

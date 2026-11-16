/**
 * v8 离线工具的源码格式门禁。必须在访问数据根、取得租约或创建输出前执行。
 * 不把 v9 schema 注入旧 SQL，也不提供旧运行时兼容；正式 v9转换使用独立协议。
 */
import { fail } from "./session-v7-database.mjs";

/** 目标 schema 和引用协议必须与 v8工具成套匹配，否则无副作用拒绝。 */
export function assert_v8_runtime(runtime) {
  if (runtime?.AGENT_SESSION_SCHEMA_VERSION !== 8) fail("v8_tool_runtime_version_mismatch");
}

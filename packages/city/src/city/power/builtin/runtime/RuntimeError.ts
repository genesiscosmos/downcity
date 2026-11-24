/** 将受限引擎错误归一化为公开机器错误，保留源码定位而不泄露宿主异常对象。 */
import type { RuntimeError } from "./types/Runtime.js";

/** 错误文本来自编译/解释器协议；不按内部异常原型跨边界分发。 */
export function runtime_error(message: string): RuntimeError {
  const code = /\b(compile_error|serialization_error|permission_denied|approval_denied|host_unavailable|sdk_changed|revision_conflict|execution_timeout|execution_cancelled|outcome_unknown|runtime_busy)\b/u.exec(message)?.[1] ?? "script_error";
  const location = /(?:compile_error:\s*|source:)(\d+):(\d+)/u.exec(message);
  return { code, message: message.slice(0, 8192), ...(location ? { location: { line: Number(location[1]), column: Number(location[2]) } } : {}) };
}

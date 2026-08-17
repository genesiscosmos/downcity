/**
 * Shell action 运行时公开入口。
 *
 * 关键点（中文）
 * - 本文件只作为稳定导出门面，保持旧 import 路径不变。
 * - 具体 action 编排已拆到 `session/actions/*`，避免单模块继续膨胀。
 */

export { createShellRuntimeState } from "./ShellActionRuntimeSupport.js";
export {
  bindShellRuntime,
  closeAllShellSessions,
} from "./actions/ShellLifecycleActions.js";
export {
  startShellSession,
} from "./actions/ShellStartActions.js";
export {
  closeShellSession,
  getShellSessionStatus,
  listShellSessions,
  readShellSession,
  waitShellSession,
} from "./actions/ShellQueryActions.js";
export {
  writeShellSession,
} from "./actions/ShellWriteActions.js";
export {
  execShellCommand,
} from "./actions/ShellExecActions.js";

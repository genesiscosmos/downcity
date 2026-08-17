/**
 * Workspace 内置 Shell 公开入口。
 *
 * 关键点（中文）
 * - Workspace 拥有 shell / sandbox 的领域能力，不依赖 Agent session 或 Plugin 系统。
 * - Agent 通过 Workspace 复用本地命令执行、shell session、approval 与 sandbox backend。
 */

export * from "./types/Shell.js";
export * from "./types/ShellRuntime.js";
export type {
  ShellActionResponse,
  ShellApprovalMode,
  ShellApprovalStatus,
  ShellApprovalToolName,
  ShellCloseRequest,
  ShellExecRequest,
  ShellExternalRef,
  ShellOutputChunk,
  ShellQueryRequest,
  ShellReadRequest,
  ShellSessionSnapshot,
  ShellSessionStatus,
  ShellStartRequest,
  ShellWaitRequest,
  ShellWriteRequest,
} from "./types/ShellAction.js";
export * from "./types/ShellRuntimeOptions.js";
export type {
  WorkspaceShell,
  WorkspaceShellSafeCommandInput,
  WorkspaceShellSafeCommandResult,
} from "./types/WorkspaceShell.js";
export * from "./types/ShellHostContext.js";
export * from "./types/ShellApproval.js";
export * from "./types/Sandbox.js";
export * from "./types/ShellCommand.js";
export * from "./Shell.js";
export * from "./sandbox/Sandbox.js";
export * from "./sandbox/SandboxPolicy.js";
export * from "./sandbox/ShellProcessHandle.js";
export * from "./session/ShellActionRuntime.js";
export * from "./session/ShellActionResponse.js";
export * from "./session/ShellRuntimeEnvironment.js";
export * from "./session/ShellCommandModel.js";
export * from "./session/ShellRuntimeTypes.js";
export * from "./approval/ShellApprovalRuntime.js";
export * from "./tool/ShellTools.js";
export * from "./tool/ShellToolSchemas.js";

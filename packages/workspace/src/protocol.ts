/**
 * Workspace Adapter 的无 Node.js 本地实现协议入口。
 *
 * Cloudflare Computer 等 Edge Adapter 应从这里导入 Workspace 协议，避免静态加载
 * 本地 Workspace、node:fs、PTY 和本地 Shell runtime。
 */

export { WorkspaceBase } from "./workspace/WorkspaceBase.js";
export type {
  FileSystem,
  WorkspaceDirectoryEntry,
} from "./types/workspace/FileSystem.js";
export type {
  FileToolActionRequest,
  FileToolActionResult,
} from "./types/workspace/FileTool.js";
export type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "./types/workspace/SearchTool.js";
export type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "./types/workspace/WorkspaceEnv.js";
export type { WorkspaceTools } from "./types/workspace/WorkspaceTools.js";
export type {
  WorkspaceToolActionMessage,
  WorkspaceToolActionResult,
} from "./types/workspace/WorkspaceToolResult.js";
export type {
  WorkspaceStorageScope,
  WorkspaceStorageProvider,
} from "./types/workspace/WorkspaceStorage.js";
export type {
  WorkspaceShell,
  WorkspaceShellSafeCommandInput,
  WorkspaceShellSafeCommandResult,
} from "./shell/types/WorkspaceShell.js";
export type {
  ResolvedSandboxPolicy,
  SandboxBackend,
  SandboxNetworkMode,
  SandboxPreflightIssue,
  SandboxPreflightIssueCode,
  SandboxPreflightResult,
  SandboxSpawnRequest,
  SandboxSpawnResult,
  ShellProcessHandle,
  ShellSafePolicy,
  ShellSandboxAdapter,
  ShellSandboxHostInput,
  UnrestrictedSpawnRequest,
} from "./shell/types/Sandbox.js";

/** @downcity/type/workspace：Workspace 与 Storage 中立协议入口。 */

export type { StorageProvider, StorageScope } from "./types/storage/Storage.js";
export type { FileSystem, WorkspaceDirectoryEntry } from "./types/workspace/FileSystem.js";
export type * from "./types/workspace/FileTool.js";
export type * from "./types/workspace/SearchTool.js";
export type * from "./types/workspace/WorkspaceEnv.js";
export type * from "./types/workspace/WorkspaceTools.js";
export type * from "./types/workspace/WorkspaceToolResult.js";
export type { WorkspaceRuntime } from "./types/workspace/WorkspaceRuntime.js";
export {
  WORKSPACE_FILE_MUTATION_EFFECT_TYPE,
  create_workspace_file_mutation_effect,
  type WorkspaceFileMutation,
  type WorkspaceFileMutationEffect,
  type WorkspaceFileMutationObserver,
  type WorkspaceFileMutationState,
} from "./types/workspace/WorkspaceFileMutation.js";
export type {
  WorkspaceShell,
  WorkspaceShellSandboxCommandInput,
  WorkspaceShellSandboxCommandResult,
} from "./types/shell/WorkspaceShell.js";

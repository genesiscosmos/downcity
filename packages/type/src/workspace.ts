/** @downcity/type/workspace：Workspace 与 Storage 中立协议入口。 */

export type {
  StorageDatabaseLocation,
  StorageProvider,
  StorageScope,
} from "./types/storage/Storage.js";
export type { FileSystem, WorkspaceDirectoryEntry } from "./types/workspace/FileSystem.js";
export type * from "./types/workspace/FileTool.js";
export { estimate_image_tokens, read_image_dimensions, image_header_bytes, unknown_image_tokens, type ImageDimensions } from "./types/workspace/ImageBudget.js";
export { max_explicit_media_bytes, max_request_media_bytes, file_read_version } from "./types/workspace/AttachmentPolicy.js";
export type * from "./types/workspace/SearchTool.js";
export type * from "./types/workspace/WorkspaceEnv.js";
export type * from "./types/workspace/WorkspaceTools.js";
export type * from "./types/workspace/WorkspaceToolResult.js";
export type { WorkspaceRuntime } from "./types/workspace/WorkspaceRuntime.js";
export type { WorkspaceSandboxMountRequest } from "./types/shell/Sandbox.js";
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

/**
 * @downcity/workspace 公开入口。
 *
 * Workspace 拥有项目资源边界、文件工具、环境变量和可选 Shell。
 * Agent、Session 与 Plugin 执行语义由 @downcity/agent 继续负责。
 */

export { Workspace } from "./workspace/Workspace.js";
export { WorkspaceBase } from "./workspace/WorkspaceBase.js";
export { LocalFileSystem } from "./workspace/LocalFileSystem.js";
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
export type { WorkspaceOptions } from "./types/workspace/Workspace.js";
export type { LocalFileSystemOptions } from "./types/workspace/LocalFileSystem.js";
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
export {
  load_project_dotenv,
  resolve_workspace_env,
} from "./workspace/WorkspaceEnv.js";

export * from "./shell/index.js";

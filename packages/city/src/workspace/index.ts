/**
 * City Workspace 公开实现入口。
 *
 * City 提供本地 Workspace、文件系统和 Storage 实现；跨平台协议统一由
 * `@downcity/type/workspace` 提供，Agent 不依赖本模块。
 */

export { Workspace } from "./Workspace.js";
export { LocalFileSystem } from "./LocalFileSystem.js";
export { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
export { MemoryStorageProvider } from "./storage/MemoryStorageProvider.js";
export {
  load_project_dotenv,
  resolve_workspace_env,
} from "./WorkspaceEnv.js";
export type { WorkspaceOptions } from "@/types/workspace/Workspace.js";
export type { LocalFileSystemOptions } from "@/types/workspace/LocalFileSystem.js";
export type * from "@downcity/type/workspace";

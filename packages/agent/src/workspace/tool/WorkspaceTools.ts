/**
 * Workspace Tools 组合模块。
 *
 * 职责说明（中文）
 * - 统一创建当前 Workspace 的文件、搜索与可选 Shell 工具。
 * - 这里只组合 Workspace 资源，不注册 Plugin Tool 或调用方自定义 Tool。
 */

import { create_file_tools } from "@/workspace/tool/FileTools.js";
import { create_search_tools } from "@/workspace/tool/SearchTools.js";
import type {
  CreateWorkspaceToolsOptions,
  WorkspaceTools,
} from "@/types/workspace/WorkspaceTools.js";

/** 创建当前 Workspace 的完整模型工具集合。 */
export function create_workspace_tools(
  options: CreateWorkspaceToolsOptions,
): WorkspaceTools {
  return {
    ...create_file_tools({
      run_file_action: async (request) =>
        await options.files.run_file_action(request),
    }),
    ...create_search_tools({
      run_search_action: async (request) =>
        await options.files.run_search_action(request),
    }),
    ...(options.shell?.tools || {}),
  };
}

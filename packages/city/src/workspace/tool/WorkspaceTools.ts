/**
 * Workspace Tools 组合模块。
 *
 * 职责说明（中文）
 * - 统一创建当前 Workspace 的文件与搜索工具。
 * - Shell 不在其中：它虽然属于 Workspace，但只在模型面以 `shell` power 暴露一次，
 *   避免同一个能力同时出现在 Workspace Tool 与 power 两处。
 */

import { create_file_tools } from "@/workspace/tool/FileTools.js";
import { create_search_tools } from "@/workspace/tool/SearchTools.js";
import type {
  CreateWorkspaceToolsOptions,
  WorkspaceTools,
} from "@downcity/type/workspace";

/** 创建当前 Workspace 的模型工具集合（文件与搜索）。 */
export function create_workspace_tools(
  options: CreateWorkspaceToolsOptions,
): WorkspaceTools {
  return {
    ...create_file_tools({
      run_file_action: async (request, observer) =>
        await options.files.run_file_action(request, observer),
    }),
    ...create_search_tools({
      run_search_action: async (request) =>
        await options.files.run_search_action(request),
    }),
  };
}

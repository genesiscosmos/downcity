/**
 * city tool `workspaces` namespace。
 *
 * 关键点（中文）
 * - 数据来源是当前 City 已登记的 Workspace 资源，不读本地数据文件。
 * - 只提供列表与详情；创建、改名等写操作不进入 city tool。
 */

import type {
  CityToolActionCall,
  CityToolContext,
  CityToolNamespaceProvider,
} from "@/city/types/CityTool.js";
import type { CityToolWorkspaceSummary } from "@/city/types/CityToolNamespaces.js";
import { assert_known_args, read_required_string_arg } from "@/city/tool/CityToolArgs.js";
import {
  CityToolRuntimeError,
  unexpected_city_tool_action,
} from "@/city/tool/CityToolErrors.js";

/** 构造单个 Workspace 摘要。 */
function to_summary(
  context: CityToolContext,
  workspace: CityToolContext["workspaces"][number],
): CityToolWorkspaceSummary {
  return {
    workspace_id: workspace.id,
    name: String(workspace.name || workspace.id),
    path: workspace.path,
    is_current: workspace.id === context.workspace_id,
  };
}

/** 列出当前 City 可见的全部 Workspace。 */
function list_workspaces(context: CityToolContext): { workspaces: CityToolWorkspaceSummary[] } {
  return {
    workspaces: context.workspaces.map((workspace) => to_summary(context, workspace)),
  };
}

/** 读取单个 Workspace 详情。 */
function get_workspace(call: CityToolActionCall): { workspace: CityToolWorkspaceSummary } {
  assert_known_args({ args: call.args, allowed: ["workspace_id"], action: call.action });
  const workspace_id = read_required_string_arg({
    args: call.args,
    name: "workspace_id",
    action: call.action,
  });
  const workspace = call.context.workspaces
    .find((item) => item.id === workspace_id);
  if (!workspace) {
    throw new CityToolRuntimeError({
      code: "not_found",
      message: `Workspace not visible in this City: ${workspace_id}.`,
      detail: { current_workspace_id: call.context.workspace_id },
    });
  }
  return { workspace: to_summary(call.context, workspace) };
}

/** 创建 `workspaces` namespace provider。 */
export function create_workspaces_namespace(): CityToolNamespaceProvider {
  return {
    namespace: "workspaces",
    summary: "Workspaces known to this City, including the current one.",
    actions: [
      {
        action: "list",
        summary: "List every workspace visible in this City.",
        args: [],
        returns: "workspaces(workspace_id, name, path, is_current)",
        capability: "read",
        sensitivity: "public",
      },
      {
        action: "get",
        summary: "Read one workspace by id.",
        args: [
          {
            name: "workspace_id",
            type: "string",
            required: true,
            description: "Workspace identifier, as returned by workspaces.list.",
          },
        ],
        returns: "workspace(workspace_id, name, path, is_current)",
        capability: "read",
        sensitivity: "public",
      },
    ],
    handle: async (call: CityToolActionCall) => {
      switch (call.action) {
        case "list":
          assert_known_args({ args: call.args, allowed: [], action: call.action });
          return list_workspaces(call.context);
        case "get":
          return get_workspace(call);
        default:
          throw unexpected_city_tool_action({ namespace: "workspaces", action: call.action });
      }
    },
  };
}

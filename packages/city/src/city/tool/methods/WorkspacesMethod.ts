/**
 * city tool `workspaces` method。
 *
 * 关键点（中文）
 * - 数据来源是当前 City 已登记的 Workspace 资源，不读本地数据文件。
 * - 只提供列表与详情；创建、改名等写操作不进入 city tool。
 * - `get` 与 `list` 共用同一个摘要构造，避免两处口径漂移。
 */

import type { CityToolContext } from "@/city/types/CityTool.js";
import type { CityToolWorkspaceSummary } from "@/city/types/CityToolMethods.js";
import {
  CityAction,
  string_arg,
  type CityToolArgs,
} from "@/city/tool/CityAction.js";
import { CityMethod } from "@/city/tool/CityMethod.js";
import { CityToolRuntimeError } from "@/city/tool/CityToolResult.js";

/** 把 Workspace 投影为模型可读摘要。 */
function describe_workspace(
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
class ListWorkspacesAction extends CityAction {
  readonly action = "list";
  readonly summary = "List every workspace visible in this City.";
  readonly returns = "workspaces(workspace_id, name, path, is_current)";

  protected async run(
    _args: CityToolArgs,
    context: CityToolContext,
  ): Promise<{ workspaces: CityToolWorkspaceSummary[] }> {
    return {
      workspaces: context.workspaces.map((workspace) => describe_workspace(context, workspace)),
    };
  }
}

/** 按标识读取单个 Workspace。 */
class GetWorkspaceAction extends CityAction {
  readonly action = "get";
  readonly summary = "Read one workspace by id.";
  readonly returns = "workspace(workspace_id, name, path, is_current)";
  readonly args = [
    string_arg("workspace_id", "Workspace identifier, as returned by workspaces.list."),
  ];

  protected async run(
    args: CityToolArgs,
    context: CityToolContext,
  ): Promise<{ workspace: CityToolWorkspaceSummary }> {
    const workspace_id = this.require_string(args, "workspace_id");
    const workspace = context.workspaces.find((item) => item.id === workspace_id);
    if (!workspace) {
      throw new CityToolRuntimeError({
        code: "not_found",
        message: `Workspace not visible in this City: ${workspace_id}.`,
        detail: { current_workspace_id: context.workspace_id },
      });
    }
    return { workspace: describe_workspace(context, workspace) };
  }
}

/** `workspaces` method。 */
export class WorkspacesMethod extends CityMethod {
  readonly method = "workspaces";
  readonly summary = "Workspaces known to this City, including the current one.";
  protected readonly actions = [new ListWorkspacesAction(), new GetWorkspaceAction()];
}

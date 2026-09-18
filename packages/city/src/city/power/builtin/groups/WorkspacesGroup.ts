/**
 * city power `workspaces` 动作组。
 *
 * 关键点（中文）
 * - 数据来源是当前 City 已登记的 Workspace 资源，不读本地数据文件。
 * - 只提供列表与详情；创建、改名等写操作不进入 city power。
 * - `get` 与 `list` 共用同一个摘要构造，避免两处口径漂移。
 */

import type { CityPowerContext } from "@/city/types/CityPowerContext.js";
import type { CityToolWorkspaceSummary } from "@/city/types/CityPowerData.js";
import { CityAction, CityActionError } from "@/city/power/builtin/CityAction.js";
import { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { z } from "zod";

/** 把 Workspace 投影为模型可读摘要。 */
function describe_workspace(
  context: CityPowerContext,
  workspace: CityPowerContext["workspaces"][number],
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
  readonly description = "List every workspace visible in this City.";
  readonly returns = "workspaces(workspace_id, name, path, is_current)";

  protected async run(
    _args: Record<string, never>,
    context: CityPowerContext,
  ): Promise<{ workspaces: CityToolWorkspaceSummary[] }> {
    return {
      workspaces: context.workspaces.map((workspace) => describe_workspace(context, workspace)),
    };
  }
}

/** `workspaces.get` 的输入。 */
const get_workspace_input = z.strictObject({
  /** Workspace identifier, as returned by workspaces.list. */
  workspace_id: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace identifier, as returned by workspaces.list."),
});

/** 按标识读取单个 Workspace。 */
class GetWorkspaceAction extends CityAction<z.infer<typeof get_workspace_input>> {
  readonly action = "get";
  readonly description = "Read one workspace by id.";
  readonly returns = "workspace(workspace_id, name, path, is_current)";
  readonly args_schema = get_workspace_input;

  protected async run(
    args: z.infer<typeof get_workspace_input>,
    context: CityPowerContext,
  ): Promise<{ workspace: CityToolWorkspaceSummary }> {
    const workspace = context.workspaces.find((item) => item.id === args.workspace_id);
    if (!workspace) {
      throw new CityActionError({
        code: "not_found",
        message: `Workspace not visible in this City: ${args.workspace_id}.`,
        detail: { current_workspace_id: context.workspace_id },
      });
    }
    return { workspace: describe_workspace(context, workspace) };
  }
}

/** `workspaces` 动作组。 */
export class WorkspacesGroup extends CityActionGroup {
  readonly group = "workspaces";
  readonly summary = "Workspaces known to this City, including the current one.";
  protected readonly actions = [new ListWorkspacesAction(), new GetWorkspaceAction()];
}

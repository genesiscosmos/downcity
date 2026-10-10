/**
 * Agent 主会话专属 Workspace 的宿主装配。
 *
 * 主会话固定使用 Agent 私有数据根下的 main 目录，不登记到用户项目 Repository。
 * 并发打开共享同一装配过程；实例由 City 持有，Agent 删除和宿主关闭时由 City 释放。
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { City } from "@downcity/city";
import type { WorkspaceRuntime } from "@downcity/type";
import type { DesktopLocalData } from "./DesktopLocalData.js";
import { create_desktop_workspace } from "./DesktopAgentAssembly.js";

/** 返回主会话专属 Workspace 的稳定标识。 */
export function get_agent_main_workspace_id(agent_id: string): string {
  return `agent-main:${agent_id}`;
}

/** 返回与存储 Provider 相同编码规则下的主会话工作目录。 */
export function get_agent_main_workspace_path(root_path: string, agent_id: string): string {
  return path.join(root_path, "agents", encodeURIComponent(agent_id), "main");
}

/** 宿主专属目录装配器；仅保存正在创建的 Promise，不另建 Workspace 索引。 */
export class AgentMainWorkspaces {
  /** 并发创建互斥；完成或失败后释放，使下次请求以 City 中的实例为准。 */
  private readonly pending = new Map<string, Promise<WorkspaceRuntime>>();

  constructor(private readonly city: City, private readonly data: DesktopLocalData) {}

  /** 返回固定 main 目录的 Workspace 实例。 */
  async require(agent_id: string): Promise<WorkspaceRuntime> {
    const workspace_id = get_agent_main_workspace_id(agent_id);
    const existing = this.city.workspaces.get(workspace_id);
    if (existing) return existing;
    const pending = this.pending.get(agent_id);
    if (pending) return await pending;
    const operation = this.create(agent_id);
    this.pending.set(agent_id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(agent_id);
    }
  }

  /** 创建私有目录并仅登记 City 运行时，不写入用户项目 Repository。 */
  private async create(agent_id: string): Promise<WorkspaceRuntime> {
    const workspace_path = get_agent_main_workspace_path(this.data.root_path, agent_id);
    await mkdir(workspace_path, { recursive: true, mode: 0o700 });
    return this.city.workspaces.add(await create_desktop_workspace(this.data, {
      workspace_id: get_agent_main_workspace_id(agent_id),
      workspace_path,
      name: `${agent_id} main`,
      created_at: "",
      updated_at: "",
    }));
  }
}

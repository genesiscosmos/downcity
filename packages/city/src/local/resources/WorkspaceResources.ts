/** Workspace 登记与生命周期用例；项目文件与 Session 历史始终保留。 */
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalWorkspaceConfig } from "../types/LocalConfig.js";
import type { ResourceDependencies } from "./types.js";
import { count_workspace_sessions, read_session_agent_references } from "./SessionReferences.js";
import { assert_resource_revision, resource_revision } from "./ResourceCoordinator.js";
import { require_resource_value, require_workspace_id, ResourceError, is_missing_file } from "./ResourceError.js";

/** 管理项目登记，路径和 SSH 授权不通过此用例修改。 */
export class WorkspaceResources {
  constructor(private readonly dependencies: ResourceDependencies) {}

  /** 登记和运行索引并集，内部 main 目录默认隐藏。 */
  async list(input: Record<string, unknown> = {}) {
    const configs = new Map((this.dependencies.workspaces?.list() ?? []).map((config) => [config.workspace_id, config]));
    const ids = new Set([...configs.keys(), ...(this.dependencies.host?.city.workspaces.list().map((workspace) => workspace.id) ?? [])]);
    const query = String(input.query ?? "").toLowerCase();
    const items: Awaited<ReturnType<WorkspaceResources["project"]>>[] = [];
    for (const id of [...ids].sort()) {
      if (id.startsWith("agent-main:") && !input.include_internal) continue;
      const item = await this.project(id, configs.get(id));
      if (!query || `${item.workspace_id}\n${item.name}\n${item.workspace_path}`.toLowerCase().includes(query)) items.push(item);
    }
    return { items, total: items.length };
  }

  /** 详情不输出 SSH socket 或密钥配置。 */
  async get(workspace_id: string) {
    require_workspace_id(workspace_id, true);
    const config = this.dependencies.workspaces?.get(workspace_id);
    if (!config && !this.dependencies.host?.city.workspaces.get(workspace_id)) throw new ResourceError("resource_not_found", `Workspace not found: ${workspace_id}`, 3);
    return { workspace: await this.project(workspace_id, config ?? undefined), session_count: await this.session_count(workspace_id) };
  }

  /** register 只验证/规范化现有目录，不创建项目资产。 */
  async register(workspace_path: string, name?: string) {
    require_resource_value(typeof workspace_path === "string" && workspace_path.trim(), "Workspace path is required");
    const real_path = await fs.realpath(path.resolve(workspace_path));
    require_resource_value((await fs.stat(real_path)).isDirectory(), "Workspace path must be a directory");
    await fs.access(real_path, fs.constants.R_OK | fs.constants.X_OK);
    if (name !== undefined) require_resource_value(typeof name === "string" && name.trim(), "name must not be empty");
    return await this.dependencies.coordinator.mutate(async () => {
      const repository = this.dependencies.workspaces;
      if (!repository) throw new ResourceError("internal_error", "Workspace repository is unavailable for a write operation", 1);
      // 对旧记录只报告 alias 冲突，不自动合并稳定 ID。
      const aliases: string[] = [];
      for (const config of repository.list()) {
        if (config.workspace_path === real_path) continue;
        try { if (await fs.realpath(config.workspace_path) === real_path) aliases.push(config.workspace_id); }
        catch (error) { if (!is_missing_file(error)) throw error; }
      }
      if (aliases.length) throw new ResourceError("dependency_conflict", "Existing Workspace aliases resolve to this directory", 4, false, { workspace_ids: aliases });
      const existing = repository.get_by_path(real_path);
      const config = existing ?? repository.ensure({ workspace_path: real_path, name });
      this.dependencies.host?.invalidate();
      return { workspace: await this.project(config.workspace_id, config), changed: !existing, name_mismatch: !!existing && name !== undefined && name !== existing.name };
    });
  }

  /** 名称不参与 Shell/Workspace 身份，无需重建运行实例。 */
  async update(workspace_id: string, name: string, if_revision?: string) {
    require_workspace_id(workspace_id);
    require_resource_value(typeof name === "string" && name.trim(), "name must not be empty");
    return await this.dependencies.coordinator.mutate(async () => {
      const current = this.require_registered(workspace_id);
      assert_resource_revision(current, if_revision);
      const changed = current.name !== name.trim();
      const config = changed ? this.dependencies.workspaces!.update_name(workspace_id, name) : current;
      this.dependencies.host?.invalidate();
      return { workspace: await this.project(workspace_id, config), changed, revision: resource_revision(config) };
    });
  }

  /** 门禁先于释放；失败保持 blocked，防止懒解析重新装回旧实例。 */
  async remove(workspace_id: string, if_revision?: string) {
    require_workspace_id(workspace_id);
    return await this.dependencies.coordinator.mutate(async () => {
      const current = this.require_registered(workspace_id);
      assert_resource_revision(current, if_revision);
      const agent_ids = this.dependencies.agents.list().map((agent) => agent.agent_id);
      for (const agent_id of agent_ids) {
        const unsettled = (await read_session_agent_references(this.dependencies.root_path, [agent_id], agent_id, this.dependencies.immutable)).filter((reference) => reference.kind === "unsettled_prompt" || reference.kind === "pending_execution");
        for (const reference of unsettled) {
          const browser = new (await import("@downcity/agent")).AgentSessionBrowser({ agent_id, storage_root_path: path.join(this.dependencies.root_path, "agents", agent_id), immutable: this.dependencies.immutable });
          try { if ((await browser.get(String(reference.session_id), String(reference.category))).metadata.workspace_id === workspace_id) throw new ResourceError("resource_busy", "Workspace has unsettled persisted execution", 4); }
          finally { browser.dispose(); }
        }
      }
      const retained_session_count = await this.session_count(workspace_id);
      const { host, coordinator } = this.dependencies;
      const releases: (() => void)[] = [];
      try {
        for (const agent of host?.city.agents.list() ?? []) releases.push(agent.sessions.guard_idle(workspace_id));
      } catch (error) { for (const release of releases) release(); throw error; }
      coordinator.blocked_workspaces.add(workspace_id);
      let releasing = false;
      try {
        await host?.assert_workspace_idle(workspace_id);
        releasing = true;
        await host?.release_workspace?.(workspace_id);
        if (host?.city.workspaces.get(workspace_id)) await host.city.workspaces.remove(workspace_id);
        this.dependencies.workspaces!.remove(workspace_id);
        host?.invalidate();
        return { workspace_id, removed: true, retained_project_path: current.workspace_path, retained_session_count, retained_history: true };
      } catch (error) {
        if (!releasing) { coordinator.blocked_workspaces.delete(workspace_id); throw error; }
        throw new ResourceError("partial_failure", error instanceof Error ? error.message : "Workspace release failed", 9, false, { committed: false, blocked: true, retained_project_path: current.workspace_path });
      } finally { for (const release of releases) release(); }
    });
  }

  private async session_count(workspace_id: string): Promise<number> {
    return await count_workspace_sessions(this.dependencies.root_path, this.dependencies.agents.list().map((agent) => agent.agent_id), workspace_id, this.dependencies.immutable);
  }

  private require_registered(workspace_id: string): LocalWorkspaceConfig {
    const config = this.dependencies.workspaces?.get(workspace_id);
    if (!config) throw new ResourceError("resource_not_found", `Workspace not registered: ${workspace_id}`, 3);
    return config;
  }

  private async project(workspace_id: string, config?: LocalWorkspaceConfig) {
    const runtime = this.dependencies.host?.city.workspaces.get(workspace_id);
    const workspace_path = config?.workspace_path ?? runtime?.path ?? null;
    let path_state = "unknown";
    if (workspace_path) {
      try { path_state = (await fs.stat(workspace_path)).isDirectory() ? "available" : "inaccessible"; }
      catch (error) { path_state = is_missing_file(error) ? "missing" : "inaccessible"; }
    }
    return { workspace_id, name: config?.name ?? workspace_id, workspace_path, registered: !!config, internal: workspace_id.startsWith("agent-main:"), path_state, runtime_state: this.dependencies.coordinator.blocked_workspaces.has(workspace_id) ? "blocked" : this.dependencies.host ? runtime ? "loaded" : "unloaded" : "unknown", created_at: config?.created_at ?? null, updated_at: config?.updated_at ?? null, revision: config ? resource_revision(config) : null, ssh_authorized: config?.ssh !== undefined };
  }
}

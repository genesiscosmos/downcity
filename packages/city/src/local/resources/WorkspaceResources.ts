/** Workspace 登记与生命周期用例；项目文件与 Session 历史始终保留。 */
import fs from "node:fs/promises";
import { SshWorkspace, SshHostKeyError, normalize_ssh_host, type SshRequestOptions } from "@downcity/workspace-ssh";
import path from "node:path";
import type { LocalWorkspaceConfig } from "../types/LocalConfig.js";
import type { ResourceDependencies } from "./types.js";
import { count_workspace_sessions, read_session_agent_references } from "./SessionReferences.js";
import { assert_resource_revision, resource_revision } from "./ResourceCoordinator.js";
import { require_resource_value, require_workspace_id, ResourceError, is_missing_file } from "./ResourceError.js";

/** SSH 登记中的显式安装选择和主机确认。 */
interface WorkspaceRegistrationOptions {
  /** 在登记前安装缺失的 SSH Workspace 依赖。 */
  initialize_dependencies?: boolean;
  /** Desktop 原生对话框已确认的 OpenSSH 主机指纹提示。 */
  confirmed_prompt?: string;
}

/** 管理项目登记，路径和 SSH 授权不通过此用例修改。 */
export class WorkspaceResources {
  private readonly initializing_hosts = new Set<string>();

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

  /** 登记现有目录；仅显式选择时初始化 SSH 依赖，不写入项目资产。 */
  async register(workspace_path: string, name?: string, source?: LocalWorkspaceConfig["source"], options: WorkspaceRegistrationOptions = {}) {
    if (source) require_resource_value(source.kind === "ssh" && typeof source.host === "string", "SSH source requires kind=ssh and host");
    require_resource_value(!options.initialize_dependencies || source?.kind === "ssh", "Dependency initialization requires an SSH Workspace");
    if (source) return await this.register_remote(workspace_path, name, source, options);
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
        if (config.source || config.workspace_path === real_path) continue;
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

  /** 验证远端目录后才登记；未知身份通过结构化挑战返回，确认仅用于当前目标。 */
  private async register_remote(workspace_path: string, name: string | undefined, source: NonNullable<LocalWorkspaceConfig["source"]>, options: WorkspaceRegistrationOptions) {
    source = { kind: "ssh", host: normalize_ssh_host(source.host) };
    const workspace = new SshWorkspace({ id: "registration", root_path: workspace_path, host: source.host });
    try {
      let validation;
      const request = { discover_host: true, confirmed_prompt: options.confirmed_prompt };
      try {
        validation = options.initialize_dependencies
          ? await this.initialize_remote(workspace, source.host, request)
          : await workspace.validate(request);
      }
      catch (error) {
        if (error instanceof SshHostKeyError) throw new ResourceError("dependency_conflict", "SSH host identity requires explicit confirmation", 4, false, { ssh_host_challenge: error.challenge });
        throw error;
      }
      return await this.dependencies.coordinator.mutate(async () => {
        const repository = this.dependencies.workspaces;
        if (!repository) throw new Error("Workspace repository is unavailable");
        const existing = repository.list().find((item) => item.source?.host === source.host && item.workspace_path === validation.root_path);
        const config = existing ?? repository.ensure({ workspace_path: validation.root_path, name, source });
        this.dependencies.host?.invalidate();
        return { workspace: await this.project(config.workspace_id, config), changed: !existing, name_mismatch: !!existing && !!name && name !== existing.name };
      });
    } finally { await workspace.dispose(); }
  }

  /** 已登记的 SSH Workspace 可补齐依赖，仍使用登记的主机及规范路径。 */
  async initialize(workspace_id: string) {
    require_workspace_id(workspace_id);
    const config = this.require_registered(workspace_id);
    const source = config.source;
    require_resource_value(source?.kind === "ssh", "Dependency initialization requires an SSH Workspace");
    const workspace = new SshWorkspace({ id: workspace_id, root_path: config.workspace_path, host: source.host, canonical_root: true });
    try {
      await this.initialize_remote(workspace, source.host);
      return { workspace_id, dependencies_ready: true };
    } finally { await workspace.dispose(); }
  }

  /** 同一个 SSH 目标同时只安装一次；远端网络等待不占用资源协调器。 */
  private async initialize_remote(workspace: SshWorkspace, host: string, request?: SshRequestOptions) {
    if (this.initializing_hosts.has(host)) throw new ResourceError("resource_busy", `Dependency initialization is already running for ${host}`, 4);
    this.initializing_hosts.add(host);
    try { return await workspace.initialize(request); }
    finally { this.initializing_hosts.delete(host); }
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
          finally { await browser.dispose(); }
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
    if (config?.source) path_state = "remote";
    else if (workspace_path) {
      try { path_state = (await fs.stat(workspace_path)).isDirectory() ? "available" : "inaccessible"; }
      catch (error) { path_state = is_missing_file(error) ? "missing" : "inaccessible"; }
    }
    return { source: config?.source ?? { kind: "local" }, workspace_id, name: config?.name ?? workspace_id, workspace_path, registered: !!config, internal: workspace_id.startsWith("agent-main:"), path_state, runtime_state: this.dependencies.coordinator.blocked_workspaces.has(workspace_id) ? "blocked" : this.dependencies.host ? runtime ? "loaded" : "unloaded" : "unknown", created_at: config?.created_at ?? null, updated_at: config?.updated_at ?? null, revision: config ? resource_revision(config) : null, ssh_authorized: config?.ssh !== undefined };
  }
}

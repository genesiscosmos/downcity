/** Agent 身份配置用例；创建独立于项目，更新仅作用于新 Session，删除受执行/引用门禁保护。 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { create_agent_id } from "../repositories/AgentRepository.js";
import { read_session_agent_references } from "./SessionReferences.js";
import type { LocalAgentConfig } from "../types/LocalConfig.js";
import type { ResourceDependencies } from "./types.js";
import { assert_resource_revision, resource_revision } from "./ResourceCoordinator.js";
import { require_agent_id, require_resource_value, ResourceError } from "./ResourceError.js";

/** CLI、TUI 与 Desktop 共用的 Agent 业务实现。 */
export class AgentResources {
  constructor(private readonly dependencies: ResourceDependencies) {}

  /** 登记与运行实例的并集，运行状态只从当前宿主取得。 */
  list(input: Record<string, unknown> = {}) {
    require_resource_value(!(input.loaded && input.unloaded), "loaded and unloaded are mutually exclusive");
    const { agents, host } = this.dependencies;
    if ((input.loaded || input.unloaded) && !host) throw new ResourceError("host_offline", "Runtime filtering requires a connected City host", 5);
    const configs = new Map(agents.list().map((config) => [config.agent_id, config]));
    const ids = new Set([...configs.keys(), ...(host?.city.agents.list().map((agent) => agent.id) ?? [])]);
    const query = String(input.query ?? "").toLowerCase();
    const items = [...ids].sort().map((id) => this.project(id, configs.get(id))).filter((item) =>
      (!query || `${item.agent_id}\n${item.name}`.toLowerCase().includes(query)) &&
      (!input.loaded || item.runtime_state === "loaded") && (!input.unloaded || item.runtime_state === "unloaded"));
    return { items, total: items.length };
  }

  /** 详情默认不公开主体指令或任何环境配置。 */
  async get(agent_id: string, include_instruction = false) {
    require_agent_id(agent_id);
    const config = this.dependencies.agents.get(agent_id);
    if (!config && !this.dependencies.host?.city.agents.get(agent_id)) throw new ResourceError("resource_not_found", `Agent not found: ${agent_id}`, 3);
    return { agent: { ...this.project(agent_id, config ?? undefined), ...(include_instruction ? { instruction: config?.instruction ?? null } : {}), references: await this.dependencies.agent_references(agent_id) } };
  }

  /** 新建纯身份配置；不 mkdir 项目、不初始化 skills、不绑定 Workspace。 */
  async create(input: Record<string, unknown>) {
    require_resource_value(typeof input.name === "string" && input.name.trim(), "name is required");
    const agent_id = input.id === undefined ? create_agent_id(input.name) : input.id;
    require_agent_id(agent_id);
    return await this.dependencies.coordinator.mutate(async () => {
      if (this.dependencies.coordinator.blocked_agents.has(agent_id)) throw new ResourceError("resource_busy", "Agent ID has an incomplete runtime application or deletion; recover it before reuse", 4);
      if (this.dependencies.agents.get(agent_id) || this.dependencies.host?.city.agents.get(agent_id)) throw new ResourceError("dependency_conflict", `Agent already exists: ${agent_id}`, 4);
      const references = await this.dependencies.agent_references(agent_id);
      if (references.length) throw new ResourceError("dependency_conflict", "Agent ID has unresolved references", 4, false, { references });
      const model_id = optional_model(input.model);
      await this.dependencies.host?.resolve_model(model_id);
      const config = this.dependencies.agents.create({ agent_id, name: input.name as string, description: optional_text(input.description) ?? "", instruction: optional_text(input.instruction) ?? "", ...(model_id ? { execution: { model_id } } : {}) });
      try {
        if (this.dependencies.host) this.dependencies.host.city.agents.add(await this.dependencies.host.create_agent(config));
      } catch (error) { this.application_failed(config, error); }
      this.dependencies.host?.invalidate();
      return this.saved_result(config, true);
    });
  }

  /** 保存前解析模型；同值重试仍应用运行配置，历史 Session 快照不批量改写。 */
  async update(agent_id: string, input: Record<string, unknown>) {
    require_agent_id(agent_id);
    require_resource_value(["name", "description", "model", "instruction", "unset_model"].some((key) => input[key] !== undefined && input[key] !== false), "At least one Agent configuration field is required");
    require_resource_value(!(input.model !== undefined && input.unset_model), "model and unset_model are mutually exclusive");
    return await this.dependencies.coordinator.mutate(async () => {
      const current = this.require_registered(agent_id);
      assert_resource_revision(current, optional_text(input.if_revision));
      const name = optional_text(input.name);
      if (name !== undefined) require_resource_value(name.trim(), "name must not be empty");
      const execution = { ...current.execution };
      if (input.unset_model) delete execution.model_id;
      else if (input.model !== undefined) execution.model_id = optional_model(input.model)!;
      if (input.reasoning_effort !== undefined) {
        const effort = optional_text(input.reasoning_effort)!;
        if (effort) execution.reasoning_effort = effort;
        else delete execution.reasoning_effort;
      }
      const next = { ...current, ...(name !== undefined ? { name: name.trim() } : {}), ...(input.description !== undefined ? { description: optional_text(input.description)! } : {}), ...(input.instruction !== undefined ? { instruction: optional_text(input.instruction)! } : {}), execution };
      const model = await this.dependencies.host?.resolve_model(typeof execution.model_id === "string" ? execution.model_id : undefined, next);
      const changed = resource_revision(next) !== resource_revision(current);
      const config = changed ? this.dependencies.agents.save(next) : current;
      try {
        const host = this.dependencies.host;
        if (host) {
          const agent = host.city.agents.get(agent_id);
          if (agent) agent.reconfigure({ name: config.name, description: config.description, instruction: config.instruction, model });
          else host.city.agents.add(await host.create_agent(config));
          this.dependencies.coordinator.blocked_agents.delete(agent_id);
          host.invalidate();
        }
      } catch (error) { this.application_failed(config, error); }
      return this.saved_result(config, changed);
    });
  }

  /** 永久删除自有 scope；只释放空闲运行资源，绝不隐式 stop 或级联删除外部资源。 */
  async delete(agent_id: string, if_revision?: string) {
    require_agent_id(agent_id);
    return await this.dependencies.coordinator.mutate(async () => {
      const config = this.require_registered(agent_id);
      assert_resource_revision(config, if_revision);
      const references = [...await this.dependencies.agent_references(agent_id), ...await read_session_agent_references(this.dependencies.root_path, this.dependencies.agents.list().map((item) => item.agent_id), agent_id, this.dependencies.immutable)];
      if (references.length) throw new ResourceError("dependency_conflict", "Resolve Agent references before permanent deletion", 4, false, { references });
      const host = this.dependencies.host;
      if (host?.city.agents.get(agent_id)?.sessions.list_executing_session_ids().length) throw new ResourceError("resource_busy", "Agent has active or queued work", 4);
      const coordinator = this.dependencies.coordinator;
      const release_guard = host?.city.agents.get(agent_id)?.sessions.guard_idle();
      coordinator.blocked_agents.add(agent_id);
      const source = path.join(this.dependencies.root_path, "agents", agent_id);
      const trash_root = path.join(this.dependencies.root_path, "runtimes", "city", "deletions");
      const trash = path.join(trash_root, `${agent_id}-${randomUUID()}`);
      let committed = false;
      try {
        if (host) {
          await host.release_agent(agent_id);
          if (host.city.agents.get(agent_id)) await host.city.agents.remove(agent_id);
        }
        await fs.mkdir(trash_root, { recursive: true, mode: 0o700 });
        await fs.rename(source, trash);
        committed = true;
        await fs.rm(trash, { recursive: true });
        coordinator.blocked_agents.delete(agent_id);
        host?.invalidate();
        return { agent_id, deleted: true, deleted_scopes: ["agent_configuration", "sessions", "archives", "attachments", "skills", "logs", "agent_power_data"], retained_references: [] };
      } catch (error) {
        throw new ResourceError("partial_failure", error instanceof Error ? error.message : "Agent deletion failed", 9, false, { committed, deleted: committed, cleanup_pending: committed });
      } finally { release_guard?.(); }
    });
  }

  private project(agent_id: string, config?: LocalAgentConfig) {
    const runtime = this.dependencies.host?.city.agents.get(agent_id);
    return { agent_id, name: config?.name ?? runtime?.name ?? agent_id, description: config?.description ?? runtime?.description ?? "", version: config?.version ?? null, model_id: config?.execution?.model_id ?? null, registered: !!config, runtime_state: this.dependencies.host ? runtime ? "loaded" : "unloaded" : "unknown", revision: config ? resource_revision(config) : null, created_at: config?.created_at ?? null, updated_at: config?.updated_at ?? null };
  }

  private require_registered(agent_id: string): LocalAgentConfig {
    const config = this.dependencies.agents.get(agent_id);
    if (!config) throw new ResourceError(this.dependencies.host?.city.agents.get(agent_id) ? "dependency_conflict" : "resource_not_found", `Agent is not registered in this root: ${agent_id}`, this.dependencies.host?.city.agents.get(agent_id) ? 4 : 3);
    return config;
  }

  private saved_result(config: LocalAgentConfig, changed: boolean) {
    const revision = resource_revision(config);
    return { agent: this.project(config.agent_id, config), changed, saved_revision: revision, applied_revision: this.dependencies.host ? revision : null, effective_scope: "new_sessions", model_validation: this.dependencies.host ? "validated" : "deferred" };
  }

  private application_failed(config: LocalAgentConfig, error: unknown): never {
    this.dependencies.coordinator.blocked_agents.add(config.agent_id);
    throw new ResourceError("partial_failure", error instanceof Error ? error.message : "Agent runtime application failed", 9, false, { committed: true, saved_revision: resource_revision(config), applied_revision: null, effective_scope: "new_sessions" });
  }
}

/** 严格区分缺省和清空，避免 String(object) 成为配置。 */
function optional_text(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  require_resource_value(typeof value === "string", "Configuration fields must be strings");
  return value;
}

/** 模型清空只接受独立 unset_model 标志。 */
function optional_model(value: unknown): string | undefined {
  const model_id = optional_text(value);
  if (model_id !== undefined) require_resource_value(model_id.trim(), "model must not be empty; use unset_model to clear it");
  return model_id?.trim();
}

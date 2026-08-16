/**
 * 文件型 Agent 定义仓储。
 *
 * 关键点（中文）
 * - `~/.downcity/agents/<agent_id>/` 是 Agent 定义的唯一事实源。
 * - 数据库不保存 Agent、instruction 或 Plugin Binding 的副本。
 * - JSON 使用临时文件加原子重命名提交，避免读取到半写状态。
 */

import path from "node:path";
import fs from "fs-extra";
import type { JsonObject } from "@downcity/agent";
import type {
  LocalAgentConfig,
  LocalAgentPluginConfig,
} from "@/types/LocalConfig.js";
import type { LocalAgentPluginBinding } from "@/types/LocalPlugin.js";
import {
  get_local_agent_path,
  get_local_agents_path,
  resolve_local_root_path,
} from "@/runtime/LocalPaths.js";

const AGENT_FILE_NAME = "agent.json";
const INSTRUCTION_FILE_NAME = "instruction.md";
const PLUGINS_FILE_NAME = "plugins.json";

interface AgentDefinitionFile {
  /** Agent 定义协议版本。 */
  schema_version: 1;
  /** Agent 稳定 ID。 */
  id: string;
  /** Agent 配置版本。 */
  version: string;
  /** 默认模型等执行配置。 */
  execution?: JsonObject;
  /** LLM 行为配置。 */
  llm?: JsonObject;
  /** 首次创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

interface AgentPluginsFile {
  /** Plugin Binding 文件协议版本。 */
  schema_version: 1;
  /** Agent 注册的全部 Plugin。 */
  plugins: LocalAgentPluginBinding[];
}

/** 读取和写入用户级 Agent 定义。 */
export class AgentRepository {
  readonly root_path: string;

  constructor(root_path_input?: string) {
    this.root_path = resolve_local_root_path(root_path_input);
  }

  /** 按 Agent ID 排序列出全部有效定义。 */
  list(): LocalAgentConfig[] {
    const root_path = get_local_agents_path(this.root_path);
    if (!fs.pathExistsSync(root_path)) return [];
    return fs.readdirSync(root_path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.get(entry.name))
      .filter((item): item is LocalAgentConfig => item !== null)
      .sort((left, right) => left.agent_id.localeCompare(right.agent_id));
  }

  /** 创建一个不绑定 Workspace 的 Agent 定义。 */
  create(input: {
    /** Agent 稳定 ID。 */
    agent_id: string;
    /** 配置版本。 */
    version?: string;
    /** 默认模型等执行配置。 */
    execution?: JsonObject;
    /** LLM 行为配置。 */
    llm?: JsonObject;
    /** Agent 稳定指令。 */
    instruction?: string;
  }): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    if (this.get(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const current_time = new Date().toISOString();
    const definition: AgentDefinitionFile = {
      schema_version: 1,
      id: agent_id,
      version: String(input.version || "1.0.0"),
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
      created_at: current_time,
      updated_at: current_time,
    };
    this.write_definition(definition);
    this.write_instruction(agent_id, String(input.instruction || ""));
    this.write_plugins(agent_id, []);
    return this.get(agent_id)!;
  }

  /** 保存一个完整 Agent 定义。 */
  save(input: LocalAgentConfig): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    const existing = this.get(agent_id);
    if (!existing) {
      const created = this.create({
        agent_id,
        version: input.version,
        execution: input.execution,
        llm: input.llm,
        instruction: input.instruction,
      });
      this.replace_plugins(agent_id, input.plugins);
      return this.get(created.agent_id)!;
    }
    this.write_definition({
      schema_version: 1,
      id: agent_id,
      version: input.version,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    });
    this.write_instruction(agent_id, input.instruction);
    this.replace_plugins(agent_id, input.plugins);
    return this.get(agent_id)!;
  }

  /** 按稳定 ID 读取 Agent 定义。 */
  get(agent_id_input: string): LocalAgentConfig | null {
    const agent_id = normalize_agent_id(agent_id_input);
    const file_path = this.definition_path(agent_id);
    if (!fs.pathExistsSync(file_path)) return null;
    const definition = this.read_json<AgentDefinitionFile>(file_path);
    if (definition.schema_version !== 1 || definition.id !== agent_id) {
      throw new Error(`Invalid Agent definition: ${agent_id}`);
    }
    return {
      agent_id,
      version: String(definition.version || "1.0.0"),
      ...(is_json_object(definition.execution) ? { execution: definition.execution } : {}),
      ...(is_json_object(definition.llm) ? { llm: definition.llm } : {}),
      instruction: this.read_instruction(agent_id),
      plugins: this.list_plugins(agent_id),
      created_at: definition.created_at,
      updated_at: definition.updated_at,
    };
  }

  /** 删除 Agent 定义目录；Session 与 Workspace 数据不在这里。 */
  remove(agent_id_input: string): void {
    fs.removeSync(get_local_agent_path(this.root_path, normalize_agent_id(agent_id_input)));
  }

  /** 读取 Agent 注册的 Plugin 配置。 */
  list_plugins(agent_id_input: string): LocalAgentPluginConfig[] {
    return this.list_plugin_bindings(agent_id_input).map((binding) => ({
      plugin_name: binding.plugin_name,
      enabled: binding.enabled,
      config: structuredClone(binding.config),
      resource_ids: [...binding.resource_ids],
    }));
  }

  /** 读取带管理时间的完整 Plugin Binding。 */
  list_plugin_bindings(agent_id_input: string): LocalAgentPluginBinding[] {
    const agent_id = normalize_agent_id(agent_id_input);
    this.require_agent(agent_id);
    const file_path = this.plugins_path(agent_id);
    if (!fs.pathExistsSync(file_path)) return [];
    const file = this.read_json<AgentPluginsFile>(file_path);
    if (file.schema_version !== 1 || !Array.isArray(file.plugins)) {
      throw new Error(`Invalid Agent plugins definition: ${agent_id}`);
    }
    return file.plugins
      .map((binding) => normalize_binding({ ...binding, agent_id }))
      .sort((left, right) => left.plugin_name.localeCompare(right.plugin_name));
  }

  /** 读取单个 Plugin Binding。 */
  get_plugin_binding(
    agent_id: string,
    plugin_name: string,
  ): LocalAgentPluginBinding | null {
    const name = String(plugin_name || "").trim();
    return this.list_plugin_bindings(agent_id)
      .find((binding) => binding.plugin_name === name) ?? null;
  }

  /** 新建或更新单个 Plugin Binding。 */
  save_plugin_binding(
    input: Omit<LocalAgentPluginBinding, "created_at" | "updated_at">,
  ): LocalAgentPluginBinding {
    const agent_id = normalize_agent_id(input.agent_id);
    const existing = this.get_plugin_binding(agent_id, input.plugin_name);
    const current_time = new Date().toISOString();
    const binding = normalize_binding({
      ...input,
      agent_id,
      created_at: existing?.created_at ?? current_time,
      updated_at: current_time,
    });
    const bindings = this.list_plugin_bindings(agent_id)
      .filter((item) => item.plugin_name !== binding.plugin_name);
    bindings.push(binding);
    this.write_plugins(agent_id, bindings);
    this.touch(agent_id);
    return binding;
  }

  /** 删除一个 Plugin Binding。 */
  remove_plugin_binding(agent_id_input: string, plugin_name_input: string): void {
    const agent_id = normalize_agent_id(agent_id_input);
    const plugin_name = String(plugin_name_input || "").trim();
    const bindings = this.list_plugin_bindings(agent_id)
      .filter((binding) => binding.plugin_name !== plugin_name);
    this.write_plugins(agent_id, bindings);
    this.touch(agent_id);
  }

  /** 使用管理视图整体替换 Plugin 配置。 */
  private replace_plugins(agent_id: string, plugins: readonly LocalAgentPluginConfig[]): void {
    const previous = new Map(
      this.list_plugin_bindings(agent_id).map((binding) => [binding.plugin_name, binding]),
    );
    const current_time = new Date().toISOString();
    this.write_plugins(agent_id, plugins.map((plugin) => normalize_binding({
      agent_id,
      plugin_name: plugin.plugin_name,
      enabled: plugin.enabled,
      config: plugin.config,
      resource_ids: [...plugin.resource_ids],
      created_at: previous.get(plugin.plugin_name)?.created_at ?? current_time,
      updated_at: current_time,
    })));
  }

  /** 更新 Agent 定义的修改时间。 */
  private touch(agent_id: string): void {
    const current = this.get(agent_id);
    if (!current) return;
    this.write_definition({
      schema_version: 1,
      id: current.agent_id,
      version: current.version,
      ...(current.execution ? { execution: current.execution } : {}),
      ...(current.llm ? { llm: current.llm } : {}),
      created_at: current.created_at,
      updated_at: new Date().toISOString(),
    });
  }

  private require_agent(agent_id: string): void {
    if (!fs.pathExistsSync(this.definition_path(agent_id))) {
      throw new Error(`Agent not found: ${agent_id}`);
    }
  }

  private read_instruction(agent_id: string): string {
    const file_path = this.instruction_path(agent_id);
    return fs.pathExistsSync(file_path) ? fs.readFileSync(file_path, "utf8") : "";
  }

  private write_instruction(agent_id: string, instruction: string): void {
    this.write_atomic(this.instruction_path(agent_id), String(instruction || ""));
  }

  private write_definition(definition: AgentDefinitionFile): void {
    this.write_atomic(
      this.definition_path(definition.id),
      `${JSON.stringify(definition, null, 2)}\n`,
    );
  }

  private write_plugins(agent_id: string, plugins: LocalAgentPluginBinding[]): void {
    const file: AgentPluginsFile = {
      schema_version: 1,
      plugins: [...plugins].sort((left, right) =>
        left.plugin_name.localeCompare(right.plugin_name)
      ),
    };
    this.write_atomic(this.plugins_path(agent_id), `${JSON.stringify(file, null, 2)}\n`);
  }

  private write_atomic(file_path: string, content: string): void {
    fs.ensureDirSync(path.dirname(file_path));
    const temp_path = `${file_path}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp_path, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp_path, file_path);
  }

  private read_json<T>(file_path: string): T {
    return JSON.parse(fs.readFileSync(file_path, "utf8")) as T;
  }

  private definition_path(agent_id: string): string {
    return path.join(get_local_agent_path(this.root_path, agent_id), AGENT_FILE_NAME);
  }

  private instruction_path(agent_id: string): string {
    return path.join(get_local_agent_path(this.root_path, agent_id), INSTRUCTION_FILE_NAME);
  }

  private plugins_path(agent_id: string): string {
    return path.join(get_local_agent_path(this.root_path, agent_id), PLUGINS_FILE_NAME);
  }
}

/** 规范化 Agent ID。 */
export function normalize_agent_id(input: string): string {
  const agent_id = String(input || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_{2,}/gu, "_");
  if (!agent_id) throw new Error("agent_id is required");
  return agent_id;
}

function is_json_object(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalize_binding(input: LocalAgentPluginBinding): LocalAgentPluginBinding {
  const plugin_name = String(input.plugin_name || "").trim();
  if (!plugin_name) throw new Error("plugin_name is required");
  return {
    agent_id: normalize_agent_id(input.agent_id),
    plugin_name,
    enabled: input.enabled === true,
    config: is_json_object(input.config) ? structuredClone(input.config) : {},
    resource_ids: [...new Set(input.resource_ids
      .map((item) => String(item || "").trim())
      .filter(Boolean))],
    created_at: String(input.created_at || "").trim(),
    updated_at: String(input.updated_at || "").trim(),
  };
}

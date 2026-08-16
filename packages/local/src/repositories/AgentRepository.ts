/**
 * 文件型 Agent 定义仓储。
 *
 * `agent.json` 保存结构化定义与 Plugin 引用，`SOUL.md` 保存 Agent 主体指令。
 * Agent、Workspace 与 Plugin 配置各自只有一个事实源。
 */

import path from "node:path";
import fs from "fs-extra";
import type { JsonObject } from "@downcity/agent";
import type {
  LocalAgentConfig,
  LocalAgentPluginReference,
} from "@/types/LocalConfig.js";
import {
  get_local_agent_path,
  get_local_agents_path,
  resolve_local_root_path,
} from "@/runtime/LocalPaths.js";

const AGENT_FILE_NAME = "agent.json";
const SOUL_FILE_NAME = "SOUL.md";

/** `agent.json` 的稳定文件协议。 */
interface AgentDefinitionFile {
  /** Agent 定义协议版本。 */
  schema_version: 2;
  /** Agent 稳定 ID。 */
  id: string;
  /** Agent 定义版本。 */
  version: string;
  /** 默认模型等执行配置。 */
  execution?: JsonObject;
  /** LLM 行为配置。 */
  llm?: JsonObject;
  /** 以 Plugin ID 为键的注册引用。 */
  plugins: Record<string, LocalAgentPluginReference>;
  /** 首次创建时间。 */
  created_at: string;
  /** 最近更新时间。 */
  updated_at: string;
}

/** 读取和写入用户级 Agent 定义。 */
export class AgentRepository {
  /** Downcity 用户级数据根目录。 */
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

  /** 创建一个不绑定 Workspace 的 Agent。 */
  create(input: {
    /** Agent 稳定 ID。 */
    agent_id: string;
    /** Agent 定义版本。 */
    version?: string;
    /** 默认模型等执行配置。 */
    execution?: JsonObject;
    /** LLM 行为配置。 */
    llm?: JsonObject;
    /** Agent 主体指令。 */
    instruction?: string;
    /** 初始 Plugin 引用。 */
    plugins?: Readonly<Record<string, LocalAgentPluginReference>>;
  }): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    if (this.get(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const current_time = new Date().toISOString();
    this.write_definition({
      schema_version: 2,
      id: agent_id,
      version: String(input.version || "1.0.0"),
      ...(input.execution ? { execution: structuredClone(input.execution) } : {}),
      ...(input.llm ? { llm: structuredClone(input.llm) } : {}),
      plugins: normalize_plugin_references(input.plugins ?? {}),
      created_at: current_time,
      updated_at: current_time,
    });
    this.write_soul(agent_id, String(input.instruction || ""));
    return this.get(agent_id)!;
  }

  /** 保存完整 Agent 定义。 */
  save(input: LocalAgentConfig): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    const existing = this.get(agent_id);
    if (!existing) return this.create(input);
    this.write_definition({
      schema_version: 2,
      id: agent_id,
      version: String(input.version || "1.0.0"),
      ...(input.execution ? { execution: structuredClone(input.execution) } : {}),
      ...(input.llm ? { llm: structuredClone(input.llm) } : {}),
      plugins: normalize_plugin_references(input.plugins),
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    });
    this.write_soul(agent_id, input.instruction);
    return this.get(agent_id)!;
  }

  /** 按稳定 ID 读取 Agent 定义。 */
  get(agent_id_input: string): LocalAgentConfig | null {
    const agent_id = normalize_agent_id(agent_id_input);
    const file_path = this.definition_path(agent_id);
    if (!fs.pathExistsSync(file_path)) return null;
    const definition = this.read_json<AgentDefinitionFile>(file_path);
    if (
      definition.schema_version !== 2
      || definition.id !== agent_id
      || !is_json_object(definition.plugins)
    ) {
      throw new Error(`Invalid Agent definition: ${agent_id}`);
    }
    return {
      agent_id,
      version: String(definition.version || "1.0.0"),
      ...(is_json_object(definition.execution)
        ? { execution: structuredClone(definition.execution) }
        : {}),
      ...(is_json_object(definition.llm) ? { llm: structuredClone(definition.llm) } : {}),
      instruction: this.read_soul(agent_id),
      plugins: normalize_plugin_references(definition.plugins),
      created_at: String(definition.created_at || ""),
      updated_at: String(definition.updated_at || ""),
    };
  }

  /** 注册或切换一个 Plugin profile。 */
  set_plugin(
    agent_id_input: string,
    plugin_id_input: string,
    reference: LocalAgentPluginReference = {},
  ): LocalAgentConfig {
    const current = this.require_agent(agent_id_input);
    const plugin_id = normalize_plugin_id(plugin_id_input);
    return this.save({
      ...current,
      plugins: {
        ...current.plugins,
        [plugin_id]: normalize_plugin_reference(reference),
      },
    });
  }

  /** 从 Agent 定义中注销一个 Plugin。 */
  remove_plugin(agent_id_input: string, plugin_id_input: string): LocalAgentConfig {
    const current = this.require_agent(agent_id_input);
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const plugins = { ...current.plugins };
    delete plugins[plugin_id];
    return this.save({ ...current, plugins });
  }

  /** 删除 Agent 定义目录；Session 与 Workspace 数据不在这里。 */
  remove(agent_id_input: string): void {
    fs.removeSync(get_local_agent_path(this.root_path, normalize_agent_id(agent_id_input)));
  }

  /** 要求 Agent 存在并返回完整管理视图。 */
  private require_agent(agent_id_input: string): LocalAgentConfig {
    const agent_id = normalize_agent_id(agent_id_input);
    const agent = this.get(agent_id);
    if (!agent) throw new Error(`Agent not found: ${agent_id}`);
    return agent;
  }

  /** 读取固定的 Agent 主体文件。 */
  private read_soul(agent_id: string): string {
    const file_path = this.soul_path(agent_id);
    return fs.pathExistsSync(file_path) ? fs.readFileSync(file_path, "utf8") : "";
  }

  /** 原子写入 Agent 主体文件。 */
  private write_soul(agent_id: string, instruction: string): void {
    this.write_atomic(this.soul_path(agent_id), String(instruction || ""));
  }

  /** 原子写入 Agent 结构化定义。 */
  private write_definition(definition: AgentDefinitionFile): void {
    this.write_atomic(
      this.definition_path(definition.id),
      `${JSON.stringify(definition, null, 2)}\n`,
    );
  }

  /** 使用同目录临时文件提交完整内容。 */
  private write_atomic(file_path: string, content: string): void {
    fs.ensureDirSync(path.dirname(file_path), { mode: 0o700 });
    fs.chmodSync(path.dirname(file_path), 0o700);
    const temp_path = `${file_path}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp_path, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp_path, file_path);
    fs.chmodSync(file_path, 0o600);
  }

  private read_json<T>(file_path: string): T {
    return JSON.parse(fs.readFileSync(file_path, "utf8")) as T;
  }

  private definition_path(agent_id: string): string {
    return path.join(get_local_agent_path(this.root_path, agent_id), AGENT_FILE_NAME);
  }

  private soul_path(agent_id: string): string {
    return path.join(get_local_agent_path(this.root_path, agent_id), SOUL_FILE_NAME);
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

/** 校验 Plugin 的公开稳定 ID。 */
export function normalize_plugin_id(input: string): string {
  const plugin_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(plugin_id)) {
    throw new Error(`Invalid Plugin ID: ${input}`);
  }
  return plugin_id;
}

/** 规范化完整 Plugin 引用表。 */
function normalize_plugin_references(
  input: Readonly<Record<string, LocalAgentPluginReference>>,
): Record<string, LocalAgentPluginReference> {
  return Object.fromEntries(Object.entries(input)
    .map(([plugin_id, reference]): [string, LocalAgentPluginReference] => [
      normalize_plugin_id(plugin_id),
      normalize_plugin_reference(reference),
    ])
    .sort((left, right) => left[0].localeCompare(right[0])));
}

/** 规范化一个 Plugin profile 引用。 */
function normalize_plugin_reference(input: LocalAgentPluginReference): LocalAgentPluginReference {
  const profile = String(input?.profile || "").trim();
  if (profile && !/^[a-z0-9][a-z0-9_-]*$/u.test(profile)) {
    throw new Error(`Invalid Plugin profile: ${profile}`);
  }
  return profile ? { profile } : {};
}

function is_json_object(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

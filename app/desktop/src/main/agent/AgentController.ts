/**
 * Desktop native Agent 与 Session 控制器。
 *
 * Electron main 直接拥有 City、Agent 和 Session 订阅。Session mutation 是 Renderer
 * 对话投影的唯一实时事实源，IPC 运行态只负责表达提交、执行、停止和失败阶段。
 */

import {
  Agent,
  Group,
  type AgentSession,
  type GroupSessionContract,
  type GroupSessionSummary,
  type AgentSessionSummary,
  type RespondSessionInteractionInput,
  type SessionApprovalMode,
  type SessionMutationUnsubscribe,
  type SessionMessage,
  type SessionMutation,
} from "@downcity/agent";
import { City } from "@downcity/city";
import type { PluginNotificationInput } from "@downcity/city/plugin";
import { clipboard, shell } from "electron";
import { LocalStorageProvider } from "@downcity/city";
import path from "node:path";
import {
  create_city_host_instance_id,
  register_city_host,
  unregister_city_host,
} from "@downcity/city";
import { create_workspace_entry, get_workspace_entry } from "@downcity/agent/internal";
import {
  type LocalAgentConfig,
  type LocalGroupConfig,
  type LocalWorkspaceConfig,
  create_agent_id,
} from "@downcity/city/local";
import type {
  DesktopAgentConnection,
  DesktopAgentSummary,
  DesktopCreateAgentInput,
  DesktopGenerateAgentDraftInput,
  DesktopAgentDraft,
  DesktopChatRewriteInput,
  DesktopChatRewriteResult,
  DesktopChatMutationEvent,
  DesktopChatHistoryPage,
  DesktopChatRuntime,
  DesktopChatRuntimeEvent,
  DesktopChatSendResult,
  DesktopChatSnapshot,
  DesktopAgentDefinition,
  DesktopUpdateAgentInput,
  DesktopModelSummary,
  DesktopSessionConfiguration,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
  DesktopWorkspaceFile,
  DesktopWorkspaceEntry,
  DesktopWorkspaceTextFile,
  DesktopChatFileInput,
  DesktopCreateGroupInput,
  DesktopGenerateGroupDraftInput,
  DesktopGroupDraft,
  DesktopUpdateGroupInput,
  DesktopGroupMessage,
  DesktopGroupEvent,
  DesktopGroupSendInput,
  DesktopGroupSummary,
  DesktopGroupSessionSummary,
} from "../../common/types/DesktopApi.js";
import type { JSONContent } from "@tiptap/core";
import { chat_input_to_session_query } from "./ChatInput.js";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import {
  create_desktop_agent_model,
  create_desktop_group_model,
  create_desktop_embassy,
  create_desktop_agent_tools,
  create_desktop_plugin_loader,
  create_desktop_workspace,
  configure_desktop_agent_model,
  list_desktop_agent_models,
  resolve_desktop_agent_model,
  resolve_desktop_city_env,
} from "./DesktopAgentAssembly.js";
import type { DesktopLocalData } from "./DesktopLocalData.js";
import type { LocalPluginLoader } from "@downcity/city/local";
import { resolve_local_agent_env } from "@downcity/city/local";
import { select_builtin_agent_avatar_path } from "./BuiltinAgentAvatar.js";
import type { PluginJsonValue } from "@downcity/city/plugin";

const session_model_settings_key = "desktop.session-models";
const session_reasoning_settings_key = "desktop.session-reasoning";
const workspace_preview_max_bytes = 2 * 1024 * 1024;
const hidden_workspace_entry_names = new Set([".git", ".DS_Store", "node_modules", "dist", "build", "out"]);

/** 解析并约束模型返回的 Agent 草稿，避免未安装 Plugin 进入创建流程。 */
function parse_agent_draft(text: string, available_plugin_ids: ReadonlySet<string>): DesktopAgentDraft {
  const json_text = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(json_text) as Record<string, unknown>;
  } catch {
    throw new Error("AI 未能生成有效的 Agent 配置，请重新生成");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const instruction = typeof value.instruction === "string" ? value.instruction.trim() : "";
  if (!name || !description || !instruction) throw new Error("AI 生成的 Agent 配置不完整，请重新生成");
  const plugin_ids = Array.isArray(value.plugin_ids)
    ? [...new Set(value.plugin_ids.filter((plugin_id): plugin_id is string => typeof plugin_id === "string" && available_plugin_ids.has(plugin_id)))]
    : [];
  return { name, description, instruction, plugin_ids };
}

/** 解析并约束模型返回的 Group 草稿，避免不存在的 Agent 成为成员。 */
function parse_group_draft(text: string, available_agent_ids: ReadonlySet<string>): DesktopGroupDraft {
  const json_text = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let value: Record<string, unknown>;
  try { value = JSON.parse(json_text) as Record<string, unknown>; } catch { throw new Error("AI 未能生成有效的 Group 配置，请重新生成"); }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const instruction = typeof value.instruction === "string" ? value.instruction.trim() : "";
  const member_agent_ids = Array.isArray(value.member_agent_ids) ? [...new Set(value.member_agent_ids.filter((agent_id): agent_id is string => typeof agent_id === "string" && available_agent_ids.has(agent_id)))] : [];
  if (!name || !instruction || member_agent_ids.length === 0) throw new Error("AI 生成的 Group 配置不完整，请重新生成");
  return { name, instruction, member_agent_ids };
}

/** Agent 控制器向 Electron 窗口广播的实时事件。 */
interface AgentControllerEvents {
  /** 广播 canonical Session mutation。 */
  mutation(event: DesktopChatMutationEvent): void;
  /** 广播 Session 运行态。 */
  runtime(event: DesktopChatRuntimeEvent): void;
  /** 广播 Group 共享消息。 */
  /** 广播 GroupSession 统一消息与状态事件。 */
  group_event(event: DesktopGroupEvent): void;
  /** 发布一个 Agent Plugin 产生的宿主通知。 */
  plugin_notification(plugin_id: string, agent_id: string, input: PluginNotificationInput): Promise<void>;
  /** 清除一个 Agent Plugin 主题的未读通知。 */
  plugin_notification_dismiss(plugin_id: string, topic_key: string): Promise<void>;
  /** 发布一个 Plugin main 产生的宿主通知。 */
  plugin_main_notification(plugin_id: string, input: PluginNotificationInput): Promise<void>;
  /** 清除一个 Plugin main 通知主题。 */
  plugin_main_notification_dismiss(plugin_id: string, topic_key: string): Promise<void>;
}

/** Electron main 内的 native Agent 生命周期控制器。 */
export class AgentController {
  /** Desktop 与 CLI 共用的本地数据库和产品 Repository。 */
  /** Desktop 读取本地 Plugin 定义与 profile 的 Loader。 */
  private readonly plugin_loader: LocalPluginLoader;
  /** Desktop 进程内的 Agent 索引与 transport 转发器。 */
  private readonly city: City;
  /** 当前 Desktop City 宿主实例标识。 */
  private readonly host_instance_id = create_city_host_instance_id();
  /** 已订阅 Session 的取消订阅函数。 */
  private readonly session_unsubscribes = new Map<string, SessionMutationUnsubscribe>();
  /** Group 消息订阅取消函数。 */
  private readonly group_unsubscribes = new Map<string, () => void>();
  /** 按 Group 与 GroupSession 标识缓存已打开的群聊上下文。 */
  private readonly group_sessions_by_key = new Map<string, GroupSessionContract>();
  /** 每个 Group 当前打开的 GroupSession 标识。 */
  private readonly active_group_session_ids = new Map<string, string>();
  /** Main 进程持有的 Session 运行态投影。 */
  private readonly runtimes = new Map<string, DesktopChatRuntime>();
  /** 当前进程已经按持久化 ID 恢复的 Session 模型。 */
  private readonly restored_session_models = new Map<string, string>();
  /** Desktop 首次访问前完成的本地 Agent 装配。 */
  private readonly ready_promise: Promise<void>;

  constructor(
    private readonly data: DesktopLocalData,
    private readonly events: AgentControllerEvents,
  ) {
    this.city = new City({
      embassy: create_desktop_embassy(data, process.env),
      storage: new LocalStorageProvider(data.root_path),
      plugin_host: {
        runtime_config: (plugin_id, agent_id) => {
          const reference = this.data.agents.get(agent_id)?.plugins[plugin_id];
          if (!reference) return {};
          return structuredClone(
            this.data.plugins.get_profile(plugin_id, reference.profile || "default") ?? {},
          );
        },
        profile_config: (plugin_id, profile_id) => ({
          get: async () => structuredClone(
            this.data.plugins.get_profile(plugin_id, profile_id) ?? {},
          ),
          set: async (config) => {
            this.data.plugins.save_profile(plugin_id, profile_id, structuredClone(config));
          },
        }),
        notifications: (plugin_id, agent_id) => ({
          publish: async (input) => {
            if (agent_id) {
              await this.events.plugin_notification(plugin_id, agent_id, input);
              return;
            }
            await this.events.plugin_main_notification(plugin_id, input);
          },
          dismiss: async (input) => {
            if (agent_id) {
              await this.events.plugin_notification_dismiss(plugin_id, input.topic_key);
              return;
            }
            await this.events.plugin_main_notification_dismiss(plugin_id, input.topic_key);
          },
        }),
        open_external: async (url) => {
          const target = new URL(url);
          if (target.protocol !== "http:" && target.protocol !== "https:") {
            throw new Error(`Plugin external URL protocol is not supported: ${target.protocol}`);
          }
          await shell.openExternal(target.toString());
        },
        show_item_in_folder: async (file_path) => {
          if (!path.isAbsolute(file_path)) {
            throw new Error("Plugin show_item_in_folder requires an absolute path");
          }
          shell.showItemInFolder(file_path);
        },
        write_clipboard_text: async (text) => {
          clipboard.writeText(String(text));
        },
      },
    });
    this.plugin_loader = create_desktop_plugin_loader(this.data);
    this.ready_promise = this.initialize_agents();
  }

  /** 等待 Desktop City 完成 Agent 装配与宿主登记。 */
  async ready(): Promise<void> {
    await this.ready_promise;
  }

  /** 在指定 Agent 与 Workspace 上调用已注册的 Agent Plugin action。 */
  async invoke_plugin_action(input: {
    /** 目标 Agent ID。 */ readonly agent_id: string;
    /** 执行上下文 Workspace ID。 */ readonly workspace_id: string;
    /** 目标 Plugin ID。 */ readonly plugin_id: string;
    /** 目标 action ID。 */ readonly action_id: string;
    /** 可选 action 输入。 */ readonly input?: PluginJsonValue;
  }): Promise<PluginJsonValue> {
    await this.ready_promise;
    await this.require_workspace_entry(input.agent_id, input.workspace_id);
    const plugins = this.city.plugins.scope({
      agent_id: input.agent_id,
      workspace_id: input.workspace_id,
    });
    return await plugins.run_action({
      plugin: input.plugin_id,
      action: input.action_id,
      ...(input.input !== undefined ? { payload: input.input } : {}),
    }) as unknown as PluginJsonValue;
  }

  /** 通过 City 调用 Plugin mainview action。 */
  async invoke_plugin_main(
    plugin_id: string,
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    await this.ready_promise;
    await this.provide_plugin(plugin_id);
    return await this.city.plugins.invoke(plugin_id, action_id, input);
  }

  /** 通过 City 调用 Plugin Profile config action。 */
  async invoke_plugin_config(
    plugin_id: string,
    profile_id: string,
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    await this.ready_promise;
    if (!this.data.plugins.get_profile(plugin_id, profile_id)) {
      throw new Error(`Plugin Profile not found: ${plugin_id}/${profile_id}`);
    }
    await this.provide_plugin(plugin_id);
    return await this.city.plugins.invoke_config(plugin_id, profile_id, action_id, input);
  }

  /** 重新加载当前 City 已持有的全部 Workspace Global Env。 */
  async reload_global_env(): Promise<void> {
    await this.ready_promise;
    for (const config of this.data.workspaces.list()) {
      const workspace = this.city.workspaces.get(config.workspace_id);
      if (!workspace) continue;
      workspace.set_env(resolve_local_agent_env({
        root_path: this.data.root_path,
        workspace_path: config.workspace_path,
        process_env: {},
      }));
    }
  }

  /** 当前是否存在仍在执行的对话，用于保护账户切换。 */
  has_active_sessions(): boolean {
    return [...this.runtimes.values()].some((runtime) => runtime.status === "submitted" || runtime.status === "streaming" || runtime.status === "waiting_input");
  }

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  async list_agents(): Promise<DesktopAgentSummary[]> {
    await this.ready_promise;
    return this.data.agents.list().map((record) => to_desktop_agent_summary(record, this.data.agents.get_avatar_url(record.agent_id)));
  }

  /** 读取 Agent 的完整本地定义，供 Renderer 编辑。 */
  async get_agent(agent_id: string): Promise<DesktopAgentDefinition> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return {
      agent_id: config.agent_id,
      name: config.name,
      description: config.description,
      model_id: typeof config.execution?.model_id === "string" ? config.execution.model_id : "",
      instruction: config.instruction,
      plugins: Object.fromEntries(Object.entries(config.plugins).map(([plugin_id, reference]) => [plugin_id, reference.profile ? { profile: reference.profile } : {}])),
    };
  }

  /** 列出独立登记的全部 Workspace。 */
  async list_workspaces(): Promise<DesktopWorkspaceSummary[]> {
    await this.ready_promise;
    return Promise.all(this.data.workspaces.list().map(to_desktop_workspace_summary));
  }

  /** 获取 Desktop Agent 主聊天固定使用的本地 Workspace。 */
  async get_default_workspace(): Promise<DesktopWorkspaceSummary> {
    await this.ready_promise;
    const workspace_path = path.join(this.data.root_path, "workspaces", "app");
    await mkdir(workspace_path, { recursive: true });
    const config = this.data.workspaces.ensure({ workspace_path, name: "app" });
    await this.register_workspace_in_city(config);
    return await to_desktop_workspace_summary(config);
  }

  /** 独立登记 Workspace，不隐式创建 Agent 或 Session。 */
  async create_workspace(
    input: import("../../common/types/DesktopApi.js").DesktopCreateWorkspaceInput,
  ): Promise<DesktopWorkspaceSummary> {
    await this.ready_promise;
    const normalized_path = String(input.workspace_path || "").trim();
    if (!normalized_path) throw new Error("workspace_path is required");
    const config = this.data.workspaces.ensure({
      workspace_path: normalized_path,
      name: String(input.name || "").trim(),
    });
    await this.register_workspace_in_city(config);
    return await to_desktop_workspace_summary(config);
  }

  /** 更新 Workspace Registry 中的显示名称。 */
  async update_workspace_name(
    workspace_id: string,
    name: string,
  ): Promise<DesktopWorkspaceSummary> {
    await this.ready_promise;
    return await to_desktop_workspace_summary(this.data.workspaces.update_name(workspace_id, name));
  }

  /** 从 Registry 移除 Workspace；不删除磁盘目录，仅释放运行资源。 */
  async remove_workspace(workspace_id: string): Promise<boolean> {
    await this.ready_promise;
    const normalized_workspace_id = String(workspace_id || "").trim();
    const existed = this.data.workspaces.remove(normalized_workspace_id);
    // 让所有已进入该 Workspace 的 Agent 离开并释放执行资源。
    for (const agent of this.city.agents.list()) {
      const entry = get_workspace_entry(agent, normalized_workspace_id);
      if (entry) await entry.leave();
    }
    // 清理该 Workspace 下全部 Session 的订阅与运行态。
    for (const [session_key, unsubscribe] of [...this.session_unsubscribes]) {
      if (session_key.split(":")[1] === normalized_workspace_id) {
        unsubscribe();
        this.session_unsubscribes.delete(session_key);
        this.runtimes.delete(session_key);
        this.restored_session_models.delete(session_key);
      }
    }
    // 清理该 Workspace 的 Session 模型与推理覆盖设置。
    const model_ids = this.read_session_model_ids();
    let model_ids_dirty = false;
    for (const session_key of Object.keys(model_ids)) {
      if (session_key.split(":")[1] === normalized_workspace_id) {
        delete model_ids[session_key];
        model_ids_dirty = true;
      }
    }
    if (model_ids_dirty) this.data.settings.set(session_model_settings_key, model_ids);
    const reasoning = this.read_session_reasoning_efforts();
    let reasoning_dirty = false;
    for (const session_key of Object.keys(reasoning)) {
      if (session_key.split(":")[1] === normalized_workspace_id) {
        delete reasoning[session_key];
        reasoning_dirty = true;
      }
    }
    if (reasoning_dirty) this.data.settings.set(session_reasoning_settings_key, reasoning);
    // 释放 City 持有的 Workspace 资源（shell 与 sandbox）。
    await this.city.workspaces.remove(normalized_workspace_id);
    return existed;
  }

  /** 将 Workspace 说明写入项目根目录 README.md。 */
  async write_workspace_readme(workspace_id: string, content: string): Promise<DesktopWorkspaceSummary> {
    await this.ready_promise;
    const workspace = this.data.workspaces.get(workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${workspace_id}`);
    await writeFile(path.join(workspace.workspace_path, "README.md"), String(content || ""), "utf8");
    return await to_desktop_workspace_summary(workspace);
  }

  /** 创建一个不绑定 Workspace 的 Agent。 */
  async create_agent(
    input: DesktopCreateAgentInput,
  ): Promise<{ agent: DesktopAgentSummary }> {
    const name = String(input.name || "").trim();
    const description = String(input.description || "").trim();
    const normalized_model_id = String(input.model_id || "").trim();
    if (!name) throw new Error("Agent name is required");
    if (!normalized_model_id) throw new Error("model_id is required");
    await this.ready_promise;
    const agent_id = create_agent_id(name);
    if (this.data.agents.get(agent_id)) throw new Error(`名称“${name}”生成的 Agent ID 已存在：${agent_id}`);
    const current_time = new Date().toISOString();
    const candidate: LocalAgentConfig = {
      agent_id,
      name,
      description,
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
      instruction: String(input.instruction || "").trim(),
      plugins: Object.fromEntries(Object.entries(input.plugins || {}).map(([plugin_id, reference]) => {
        const profile = String(reference.profile || "").trim();
        return [plugin_id, profile ? { profile } : {}];
      })),
      created_at: current_time,
      updated_at: current_time,
    };
    const agent = await this.create_native_agent(candidate);
    let config: LocalAgentConfig | null = null;
    let registered = false;
    try {
      config = this.data.agents.create(candidate);
      // 关键点（中文）：创建时即保存独立头像，后续扩充内置池不会改变既有 Agent 身份。
      this.data.agents.set_avatar(config.agent_id, select_builtin_agent_avatar_path());
      this.city.agents.add(agent);
      registered = true;
    } catch (error) {
      if (registered) await this.city.agents.remove(agent.id).catch(() => null);
      if (config) this.data.agents.remove(config.agent_id);
      await agent.dispose().catch(() => undefined);
      throw error;
    }
    return {
      agent: to_desktop_agent_summary({
        agent_id: agent.id,
        name: config.name,
        description: config.description,
        version: config.version,
        execution: config.execution,
      }, this.data.agents.get_avatar_url(agent.id)),
    };
  }

  /** 使用系统默认模型生成一份尚未持久化的 Agent 定义草稿。 */
  async generate_agent_draft(input: DesktopGenerateAgentDraftInput): Promise<DesktopAgentDraft> {
    await this.ready_promise;
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("请描述想创建的角色");
    const model = await resolve_desktop_agent_model(this.data, input.model_id, resolve_desktop_city_env(this.data));
    const plugin_catalog = input.plugins.map((plugin) => ({
      plugin_id: String(plugin.plugin_id || "").trim(),
      title: String(plugin.title || "").trim(),
      description: String(plugin.description || "").trim(),
    })).filter((plugin) => plugin.plugin_id);
    const response = await model.stream({ messages: [
      { role: "system", content: [{ type: "text", text: "你负责设计一名 AI Agent。只输出一个 JSON 对象，不使用 Markdown。字段必须是 name、description、instruction、plugin_ids。name 简短自然；description 是一句对外介绍；instruction 使用中文，清晰定义角色、目标、工作原则和输出要求；plugin_ids 只能取自用户提供的列表，没有必要时为空数组。" }] },
      { role: "user", content: [{ type: "text", text: `角色描述：\n${prompt}\n\n可用 Plugins：\n${JSON.stringify(plugin_catalog)}` }] },
    ] });
    let text = "";
    for await (const event of response) {
      if (event.type === "model_error") throw new Error(event.error.message);
      if (event.type === "text_delta") text += event.delta;
    }
    return parse_agent_draft(text, new Set(plugin_catalog.map((plugin) => plugin.plugin_id)));
  }

  /** 保存 Agent 定义，并以同一稳定 ID 替换进程内实例。 */
  async update_agent(agent_id: string, input: DesktopUpdateAgentInput): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    const current = this.data.agents.get(agent_id);
    if (!current) throw new Error(`Agent not found: ${agent_id}`);
    if ([...this.runtimes.values()].some((runtime) => runtime.agent_id === current.agent_id && (runtime.status === "submitted" || runtime.status === "streaming" || runtime.status === "waiting_input"))) {
      throw new Error("Agent 正在执行 Session，请等待执行结束后再编辑");
    }
    const model_id = String(input.model_id || "").trim();
    const name = String(input.name || "").trim();
    if (!name) throw new Error("Agent name is required");
    if (!model_id) throw new Error("model_id is required");
    const duplicate_name = this.data.agents.list().find((agent) => agent.agent_id !== current.agent_id && agent.name === name);
    if (duplicate_name) throw new Error(`Agent 名称已存在：${name}`);
    const candidate: LocalAgentConfig = {
      ...current,
      name,
      description: String(input.description || "").trim(),
      execution: { ...current.execution, type: "api", model_id },
      instruction: String(input.instruction || ""),
      plugins: Object.fromEntries(Object.entries(input.plugins || {}).map(([plugin_id, reference]) => {
        const profile = String(reference.profile || "").trim();
        return [plugin_id, profile ? { profile } : {}];
      })),
      updated_at: new Date().toISOString(),
    };
    const replacement = await this.create_native_agent(candidate);
    let saved = false;
    let previous_agent: Agent | null = null;
    try {
      this.data.agents.save(candidate);
      saved = true;
      previous_agent = this.city.agents.get(current.agent_id);
      if (previous_agent) await this.city.agents.remove(previous_agent.id);
      this.city.agents.add(replacement);
    } catch (error) {
      await this.city.agents.remove(replacement.id).catch(() => null);
      if (previous_agent) {
        const restored = await this.create_native_agent(current);
        this.city.agents.add(restored);
      }
      if (saved) this.data.agents.save(current);
      await replacement.dispose().catch(() => undefined);
      throw error;
    }
    for (const [session_key, unsubscribe] of this.session_unsubscribes) {
      if (!session_key.startsWith(`${current.agent_id}:`)) continue;
      unsubscribe();
      this.session_unsubscribes.delete(session_key);
      this.runtimes.delete(session_key);
      this.restored_session_models.delete(session_key);
    }
    for (const config of this.data.groups.list()) {
      if (!config.member_agent_ids.includes(current.agent_id)) continue;
      const existing_group = this.city.groups.get(config.group_id);
      const had_group_subscription = [...this.group_unsubscribes.keys()].some((key) => key.startsWith(`${config.group_id}:`));
      this.remove_group_session_cache(config.group_id);
      if (existing_group) await this.city.groups.remove(config.group_id);
      const rebuilt_group = this.create_runtime_group(config);
      this.city.groups.add(rebuilt_group);
      if (had_group_subscription) this.subscribe_group(await this.require_group_session(rebuilt_group));
    }
    await previous_agent?.dispose();
    return to_desktop_agent_summary(this.data.agents.get(current.agent_id)!, this.data.agents.get_avatar_url(current.agent_id));
  }

  /** 永久删除未运行且未被 Group 引用的 Agent。 */
  async remove_agent(agent_id: string): Promise<boolean> {
    await this.ready_promise;
    const current = this.data.agents.get(agent_id);
    if (!current) return false;
    if ([...this.runtimes.values()].some((runtime) => runtime.agent_id === current.agent_id && (runtime.status === "submitted" || runtime.status === "streaming" || runtime.status === "waiting_input"))) {
      throw new Error("Agent 正在执行 Session，请等待执行结束后再删除");
    }
    const dependent_groups = this.data.groups.list().filter((group) => group.member_agent_ids.includes(current.agent_id));
    if (dependent_groups.length > 0) throw new Error(`请先将 Agent 移出 Group：${dependent_groups.map((group) => group.name).join("、")}`);
    const runtime_agent = this.city.agents.get(current.agent_id);
    if (runtime_agent) await this.city.agents.remove(current.agent_id);
    for (const [session_key, unsubscribe] of this.session_unsubscribes) {
      if (!session_key.startsWith(`${current.agent_id}:`)) continue;
      unsubscribe();
      this.session_unsubscribes.delete(session_key);
      this.runtimes.delete(session_key);
      this.restored_session_models.delete(session_key);
    }
    this.data.agents.remove(current.agent_id);
    return true;
  }

  /** 保存 Agent 头像并返回刷新后的摘要。 */
  async set_avatar(agent_id: string, source_path: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    this.data.agents.set_avatar(agent_id, source_path);
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return to_desktop_agent_summary(config, this.data.agents.get_avatar_url(config.agent_id));
  }

  /** 删除 Agent 头像并返回刷新后的摘要。 */
  async remove_avatar(agent_id: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    this.data.agents.remove_avatar(agent_id);
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return to_desktop_agent_summary(config, undefined);
  }

  /** 从 Desktop 内置头像池随机选择并保存一张头像。 */
  async generate_avatar(agent_id: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    const current_avatar_url = this.data.agents.get_avatar_url(config.agent_id);
    this.data.agents.set_avatar(config.agent_id, select_builtin_agent_avatar_path(current_avatar_url));
    return to_desktop_agent_summary(config, this.data.agents.get_avatar_url(config.agent_id));
  }

  /** 让指定 Agent 进入独立登记的 Workspace。 */
  async connect_agent(agent_id: string, workspace_id: string): Promise<DesktopAgentConnection> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    const workspace = this.data.workspaces.get(workspace_id);
    if (!workspace) throw new Error(`Workspace is not registered: ${workspace_id}`);
    if (!this.city.agents.get(config.agent_id)) throw new Error(`Agent is not available in Desktop City: ${config.agent_id}`);
    await this.require_workspace_entry(config.agent_id, workspace_id);
    return { agent_id: config.agent_id, workspace_id, workspace: await to_desktop_workspace_summary(workspace) };
  }

  /** 列出当前 City 中由本地定义恢复的运行时 Group。 */
  async list_groups(): Promise<DesktopGroupSummary[]> {
    await this.ready_promise;
    return await Promise.all(this.city.groups.list().map(async (group) => await to_desktop_group_summary(
      group,
      this.data.groups.get(group.id)?.model_id || "",
      await group.sessions.list(),
      this.active_group_session_ids.get(group.id),
    )));
  }

  /** 创建并注册一个运行时 Group。 */
  async create_group(input: DesktopCreateGroupInput): Promise<DesktopGroupSummary> {
    await this.ready_promise;
    const name = String(input.name || "").trim();
    const group_id = create_agent_id(name);
    const model_id = String(input.model_id || "").trim();
    const member_agent_ids = [...new Set((input.member_agent_ids ?? []).map((agent_id) => String(agent_id || "").trim()).filter(Boolean))];
    if (!name) throw new Error("Group name is required");
    if (!model_id) throw new Error("model_id is required");
    if (member_agent_ids.length === 0) throw new Error("至少需要一个 Group 成员 Agent");
    if (this.city.groups.get(group_id)) throw new Error(`名称“${name}”生成的 Group ID 已存在：${group_id}`);
    for (const agent_id of member_agent_ids) {
      if (!this.city.agents.get(agent_id)) throw new Error(`Agent not found in City: ${agent_id}`);
    }
    await resolve_desktop_agent_model(this.data, model_id, resolve_desktop_city_env(this.data));
    const config = this.data.groups.create({ ...input, group_id, name, model_id });
    try {
      const group = this.create_runtime_group(config);
      this.city.groups.add(group);
      return await to_desktop_group_summary(group, config.model_id, await group.sessions.list());
    } catch (error) {
      this.data.groups.remove(config.group_id);
      throw error;
    }
  }

  /** 使用所选模型生成一份尚未持久化的 Group 协作草稿。 */
  async generate_group_draft(input: DesktopGenerateGroupDraftInput): Promise<DesktopGroupDraft> {
    await this.ready_promise;
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("请描述想创建的协作团队");
    const model = await resolve_desktop_agent_model(this.data, input.model_id, resolve_desktop_city_env(this.data));
    const agent_catalog = input.agents.map((agent) => ({ agent_id: String(agent.agent_id || "").trim(), name: String(agent.name || "").trim(), description: String(agent.description || "").trim() })).filter((agent) => agent.agent_id);
    const stream = await model.stream({ messages: [
      { role: "system", content: [{ type: "text", text: "你负责设计一个多 Agent 协作 Group。只输出一个 JSON 对象，不使用 Markdown。字段必须是 name、instruction、member_agent_ids。name 简短自然；instruction 使用中文，清晰说明协作目标、成员分工、协作方式和交付要求；member_agent_ids 只能取自用户提供的 Agent 列表，至少选择一个。" }] },
      { role: "user", content: [{ type: "text", text: `团队描述：\n${prompt}\n\n可用 Agents：\n${JSON.stringify(agent_catalog)}` }] },
    ] });
    let text = "";
    for await (const event of stream) {
      if (event.type === "model_error") throw new Error(event.error.message);
      if (event.type === "text_delta") text += event.delta;
    }
    return parse_group_draft(text, new Set(agent_catalog.map((agent) => agent.agent_id)));
  }

  /** 更新 Group 定义，并替换 City 中的运行时主体。 */
  async update_group(group_id: string, input: DesktopUpdateGroupInput): Promise<DesktopGroupSummary> {
    await this.ready_promise;
    const current = this.data.groups.get(group_id);
    if (!current) throw new Error(`Group not found: ${group_id}`);
    const model_id = String(input.model_id || "").trim();
    if (!model_id) throw new Error("model_id is required");
    const member_agent_ids = [...new Set(input.member_agent_ids.map((agent_id) => String(agent_id || "").trim()).filter(Boolean))];
    for (const agent_id of member_agent_ids) this.require_native_agent(agent_id);
    await resolve_desktop_agent_model(this.data, model_id, resolve_desktop_city_env(this.data));
    const next = this.data.groups.update(group_id, { ...input, model_id, member_agent_ids });
    const previous_group = this.city.groups.get(current.group_id);
    const had_group_subscription = [...this.group_unsubscribes.keys()].some((key) => key.startsWith(`${current.group_id}:`));
    if (previous_group) await this.city.groups.remove(current.group_id);
    this.remove_group_session_cache(current.group_id);
    try {
      const group = this.create_runtime_group(next);
      this.city.groups.add(group);
      if (had_group_subscription) this.subscribe_group(await this.require_group_session(group));
      return await to_desktop_group_summary(group, next.model_id, await group.sessions.list(), this.active_group_session_ids.get(group.id));
    } catch (error) {
      const restored = this.create_runtime_group(current);
      this.city.groups.add(restored);
      if (had_group_subscription) this.subscribe_group(await this.require_group_session(restored));
      this.data.groups.update(current.group_id, current);
      throw error;
    }
  }

  /** 删除 Group 定义和 City 中的运行时主体。 */
  async remove_group(group_id: string): Promise<boolean> {
    await this.ready_promise;
    const resolved_group_id = String(group_id || "").trim();
    const existed = this.data.groups.remove(resolved_group_id);
    if (this.city.groups.get(resolved_group_id)) await this.city.groups.remove(resolved_group_id);
    this.remove_group_session_cache(resolved_group_id);
    return existed;
  }

  /** 注册并读取 Group 的消息流。 */
  async open_group(group_id: string, session_id?: string): Promise<DesktopGroupSummary> {
    await this.ready_promise;
    const group = this.require_group(group_id);
    const group_session = await this.require_group_session(group, session_id);
    this.active_group_session_ids.set(group.id, group_session.id);
    this.subscribe_group(group_session);
    return await to_desktop_group_summary(group, this.require_group_config(group.id).model_id, await group.sessions.list(), group_session.id);
  }

  async list_group_sessions(group_id: string): Promise<DesktopGroupSessionSummary[]> {
    await this.ready_promise;
    return (await this.require_group(group_id).sessions.list()).map(to_desktop_group_session_summary);
  }

  async create_group_session(group_id: string, workspace_id?: string): Promise<DesktopGroupSummary> {
    await this.ready_promise;
    const group = this.require_group(group_id);
    const workspace = workspace_id ? await this.require_group_workspace(workspace_id) : undefined;
    const session = await group.sessions.create(workspace ? { workspace } : undefined);
    this.active_group_session_ids.set(group.id, session.id);
    this.cache_group_session(session);
    this.subscribe_group(session);
    return await to_desktop_group_summary(group, this.require_group_config(group.id).model_id, await group.sessions.list(), session.id);
  }

  /** 修改一个 GroupSession 的 canonical 用户可见标题。 */
  async rename_group_session(group_id: string, session_id: string, title: string): Promise<string> {
    await this.ready_promise;
    return await (await this.require_group_session(this.require_group(group_id), session_id)).rename(title);
  }

  async list_group_messages(group_id: string, session_id?: string): Promise<DesktopGroupMessage[]> {
    await this.ready_promise;
    const group = this.require_group(group_id);
    const group_session = await this.require_group_session(group, session_id);
    this.active_group_session_ids.set(group.id, group_session.id);
    return (await group_session.messages()).map(to_desktop_group_message);
  }

  async send_group_message(group_id: string, session_id: string | undefined, input: DesktopGroupSendInput): Promise<{ turn_id?: string }> {
    await this.ready_promise;
    const text = String(input.text || "").trim();
    if (!text) throw new Error("message is required");
    const group = this.require_group(group_id);
    if (!this.require_group_config(group.id).model_id) {
      throw new Error("Group 需要先选择群聊模型");
    }
    const group_session = await this.require_group_session(group, session_id);
    this.active_group_session_ids.set(group.id, group_session.id);
    this.subscribe_group(group_session);
    const prompt = group_session.prompt({ query: text });
    void prompt.catch(() => undefined);
    return {};
  }

  async stop_group(group_id: string, session_id?: string): Promise<void> {
    await this.ready_promise;
    await (await this.require_group_session(this.require_group(group_id), session_id)).stop();
  }

  async respond_group_interaction(group_id: string, session_id: string, input: RespondSessionInteractionInput): Promise<void> {
    await (await this.require_group_session(this.require_group(group_id), session_id)).respond_interaction(input);
  }

  async remove_group_session(group_id: string, session_id: string): Promise<DesktopGroupSummary> {
    await this.ready_promise;
    const group = this.require_group(group_id);
    const session_summary = (await group.sessions.list()).find((summary) => summary.id === session_id);
    const workspace = session_summary?.workspace_id
      ? await this.require_group_workspace(session_summary.workspace_id)
      : undefined;
    await group.sessions.remove(session_id, workspace ? { workspace } : undefined);
    this.remove_group_session_cache(group_id, session_id);
    const summaries = await group.sessions.list();
    const next_session_id = summaries[0]?.id;
    if (next_session_id) this.active_group_session_ids.set(group_id, next_session_id);
    else this.active_group_session_ids.delete(group_id);
    return await to_desktop_group_summary(group, this.require_group_config(group.id).model_id, summaries, next_session_id);
  }

  /** 列出一个 native Agent 的 Session；Workspace 可选过滤，不传时返回全部。 */
  async list_sessions(agent_id: string, workspace_id?: string): Promise<DesktopSessionSummary[]> {
    const page = await this.require_native_agent(agent_id).sessions.list(
      workspace_id ? { workspace_id } : undefined,
    );
    return page.items.map((session) => to_desktop_session_summary(this.data.root_path, session));
  }

  /** 把 Session 重新绑定到另一个 Workspace，并返回新上下文下的摘要。 */
  async rebind_session_workspace(agent_id: string, session_id: string, workspace_id: string): Promise<DesktopSessionSummary> {
    await this.ready_promise;
    const agent = this.require_native_agent(agent_id);
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace is not registered: ${workspace_id}`);
    const workspace = this.city.workspaces.get(workspace_id)
      ?? this.city.workspaces.add(await create_desktop_workspace(this.data, config));
    const session = await agent.sessions.workspace(session_id, workspace);
    return to_desktop_session_summary(this.data.root_path, await session.get_info());
  }

  /** 列出当前 Federation 中可用于 Agent 对话的模型。 */
  async list_models(): Promise<DesktopModelSummary[]> {
    await this.ready_promise;
    return await list_desktop_agent_models(this.data, resolve_desktop_city_env(this.data));
  }

  /** 在当前 Workspace 创建新的 Session。 */
  async create_session(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary> {
    const agent = this.require_native_agent(agent_id);
    const workspace = this.city.workspaces.get(workspace_id)
      ?? (await this.require_workspace_entry(agent_id, workspace_id)).workspace;
    const session = await agent.sessions.create({ workspace });
    this.observe_session(agent_id, workspace_id, session);
    return to_desktop_session_summary(this.data.root_path, await session.get_info());
  }

  /** 从 canonical Message 锚点创建分支 Session，并纳入 Desktop 实时投影。 */
  async fork_session(agent_id: string, workspace_id: string, session_id: string, message_id: string): Promise<DesktopSessionSummary> {
    const source = await this.get_session(agent_id, workspace_id, session_id);
    const source_info = await source.get_info();
    const forked = await source.fork({ message_id });
    const source_title = String(source_info.title || "新会话").trim();
    await forked.rename(`${source_title}（分支）`);
    this.observe_session(agent_id, workspace_id, forked);
    return to_desktop_session_summary(this.data.root_path, await forked.get_info());
  }

  /** 从历史用户消息之前创建新 Session，并以修改后的文本启动新 Turn。 */
  async rewrite_session_message(agent_id: string, workspace_id: string, session_id: string, input: DesktopChatRewriteInput): Promise<DesktopChatRewriteResult> {
    const source = await this.get_session(agent_id, workspace_id, session_id);
    if ((await source.status()).state === "running") throw new Error("Session 正在执行，不能编辑历史消息");
    const message_id = String(input.message_id || "").trim();
    const text = String(input.text || "").trim();
    if (!message_id) throw new Error("message_id is required");
    if (!text) throw new Error("编辑后的消息不能为空");
    if (input.action !== "fork" && input.action !== "rollback") throw new Error("不支持的历史消息重写方式");
    const source_info = await source.get_info();
    const forked = await source.fork({ message_id, include_message: false });
    const source_title = String(source_info.title || "新对话").trim();
    try {
      await forked.rename(input.action === "fork" ? `${source_title}（分支）` : source_title);
      this.observe_session(agent_id, workspace_id, forked);
      const sent = await this.send_message(agent_id, workspace_id, forked.id, { text, files: [], references: [] });
      if (input.action === "rollback") {
        await this.require_native_agent(agent_id).sessions.archive({ id: session_id });
        this.release_session_projection(agent_id, workspace_id, session_id);
      }
      return { session: to_desktop_session_summary(this.data.root_path, await forked.get_info()), turn_id: sent.turn_id };
    } catch (error) {
      await this.require_native_agent(agent_id).sessions.remove(forked.id).catch(() => false);
      this.release_session_projection(agent_id, workspace_id, forked.id);
      throw error;
    }
  }

  /** 更新 Session 的 canonical 标题。 */
  async rename_session(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    title: string,
  ): Promise<string> {
    return await (await this.get_session(agent_id, workspace_id, session_id)).rename(title);
  }

  /** 归档 Session，并释放 Desktop 对它的进程内投影。 */
  async archive_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    void workspace_id;
    await this.require_native_agent(agent_id).sessions.archive({ id: session_id });
    this.release_session_projection(agent_id, workspace_id, session_id);
  }

  /** 永久删除 Session，并释放 Desktop 对它的进程内投影。 */
  async remove_session(agent_id: string, workspace_id: string, session_id: string): Promise<boolean> {
    const removed = await this.require_native_agent(agent_id).sessions.remove(session_id);
    this.release_session_projection(agent_id, workspace_id, session_id);
    return removed;
  }

  /** 列出一个 Agent 已归档的 Session；Workspace 可选过滤，不传时返回全部。 */
  async list_archived_sessions(agent_id: string, workspace_id?: string): Promise<DesktopSessionSummary[]> {
    const page = await this.require_native_agent(agent_id).sessions.archived(
      workspace_id ? { workspace_id } : undefined,
    );
    return page.items.map((session) => to_desktop_session_summary(this.data.root_path, session, true));
  }

  /** 读取一个 native Session 的 canonical 消息和运行态。 */
  async get_chat_snapshot(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatSnapshot> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const page = await session.messages();
    return {
      messages: page.items.filter((message: SessionMessage) => message.visibility === "visible"),
      runtime: await this.read_runtime(agent_id, workspace_id, session),
      has_more: page.has_more,
      ...(page.next_before_sequence ? { next_before_sequence: page.next_before_sequence } : {}),
    };
  }

  /** 读取 Session 的一个更早历史 Segment。 */
  async get_chat_history(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    before_sequence: number,
  ): Promise<DesktopChatHistoryPage> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const page = await session.messages({ before_sequence });
    return {
      messages: page.items.filter((message: SessionMessage) => message.visibility === "visible"),
      has_more: page.has_more,
      ...(page.next_before_sequence ? { next_before_sequence: page.next_before_sequence } : {}),
    };
  }

  /** 列出当前 Workspace 根目录的直接文件，并按最近修改时间倒序返回。 */
  async list_workspace_files(workspace_id: string): Promise<DesktopWorkspaceFile[]> {
    await this.ready_promise;
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    const entries = await readdir(config.workspace_path, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const file_path = path.join(config.workspace_path, entry.name);
        const file_stat = await stat(file_path);
        return { relative_path: entry.name, filename: entry.name, modified_at: file_stat.mtimeMs };
      }));
    return files.sort((left, right) => right.modified_at - left.modified_at || left.relative_path.localeCompare(right.relative_path));
  }

  /** 列出 Workspace 内一个目录的直接子节点，目录树由 Renderer 按需展开。 */
  async list_workspace_entries(workspace_id: string, relative_path = ""): Promise<DesktopWorkspaceEntry[]> {
    const { target_path } = await this.resolve_workspace_path(workspace_id, relative_path);
    const target_stat = await stat(target_path);
    if (!target_stat.isDirectory()) throw new Error("Workspace path is not a directory");
    const entries = await readdir(target_path, { withFileTypes: true });
    const visible_entries = entries.filter((entry) => !entry.name.startsWith(".") && !hidden_workspace_entry_names.has(entry.name));
    const result = await Promise.all(visible_entries.map(async (entry): Promise<DesktopWorkspaceEntry | undefined> => {
      if (!entry.isDirectory() && !entry.isFile()) return undefined;
      const entry_relative_path = path.posix.join(normalize_workspace_relative_path(relative_path), entry.name);
      const entry_stat = await stat(path.join(target_path, entry.name));
      return {
        relative_path: entry_relative_path,
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        ...(entry.isFile() ? { size: entry_stat.size } : {}),
        modified_at: entry_stat.mtimeMs,
      };
    }));
    return result
      .filter((entry): entry is DesktopWorkspaceEntry => Boolean(entry))
      .sort((left, right) => Number(left.kind === "file") - Number(right.kind === "file") || left.name.localeCompare(right.name));
  }

  /** 读取 Workspace 内的小型 UTF-8 文本文件，供 Desktop 主视图只读预览。 */
  async read_workspace_text_file(workspace_id: string, relative_path: string): Promise<DesktopWorkspaceTextFile> {
    const { target_path } = await this.resolve_workspace_path(workspace_id, relative_path);
    const file_stat = await stat(target_path);
    if (!file_stat.isFile()) throw new Error("Workspace path is not a file");
    if (file_stat.size > workspace_preview_max_bytes) throw new Error("文件超过 2 MB，无法在 Desktop 中预览");
    const content = await readFile(target_path);
    if (content.includes(0)) throw new Error("二进制文件无法作为文本预览");
    return {
      relative_path: normalize_workspace_relative_path(relative_path),
      name: path.basename(target_path),
      content: content.toString("utf8"),
      size: file_stat.size,
    };
  }

  /** 解析并校验 Workspace 内部路径，同时阻止目录穿越与符号链接越界。 */
  private async resolve_workspace_path(workspace_id: string, relative_path: string): Promise<{ root_path: string; target_path: string }> {
    await this.ready_promise;
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    const normalized_path = normalize_workspace_relative_path(relative_path);
    const root_path = await realpath(config.workspace_path);
    const candidate_path = path.resolve(root_path, normalized_path);
    if (candidate_path !== root_path && !candidate_path.startsWith(`${root_path}${path.sep}`)) throw new Error("Workspace path is invalid");
    const target_path = await realpath(candidate_path);
    if (target_path !== root_path && !target_path.startsWith(`${root_path}${path.sep}`)) throw new Error("Workspace path escapes its root");
    return { root_path, target_path };
  }

  /** 读取 Workspace 根目录下的文件，禁止绝对路径和目录穿越。 */
  async read_workspace_file(workspace_id: string, relative_path: string): Promise<DesktopChatFileInput> {
    await this.ready_promise;
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    const normalized_path = String(relative_path || "").trim();
    if (!normalized_path || path.isAbsolute(normalized_path) || normalized_path.includes("..") || normalized_path.includes("/") || normalized_path.includes("\\")) throw new Error("Workspace file path is invalid");
    const file_path = path.join(config.workspace_path, normalized_path);
    const file_stat = await stat(file_path);
    if (!file_stat.isFile()) throw new Error("Workspace path is not a file");
    const content = await readFile(file_path);
    const media_type = workspace_file_media_type(normalized_path);
    return { filename: normalized_path, media_type, data_url: `data:${media_type};base64,${content.toString("base64")}` };
  }

  /** 向 Session 提交输入；后续执行结果通过实时事件广播。 */
  async send_message(agent_id: string, workspace_id: string, session_id: string, input: JSONContent): Promise<DesktopChatSendResult> {
    const query = chat_input_to_session_query(input);
    const session = await this.get_execution_session(agent_id, workspace_id, session_id);
    this.update_runtime({ agent_id, workspace_id, session_id, status: "submitted", updated_at: Date.now() });
    try {
      const turn = await session.prompt({ query });
      void turn.finished.catch((reason: unknown) => {
        this.update_runtime({
          agent_id,
          workspace_id,
          session_id,
          status: "failed",
          turn_id: turn.id,
          error: to_error_message(reason),
          updated_at: Date.now(),
        });
      });
      return { turn_id: turn.id };
    } catch (reason) {
      this.update_runtime({
        agent_id,
        workspace_id,
        session_id,
        status: "failed",
        error: to_error_message(reason),
        updated_at: Date.now(),
      });
      throw reason;
    }
  }

  /** 将显式压缩命令加入 Session 的有序执行队列。 */
  async compact_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    const session = await this.get_execution_session(agent_id, workspace_id, session_id);
    await session.compact();
  }

  /** 停止当前 Session Turn。 */
  async stop_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.stop();
    this.update_runtime({ agent_id, workspace_id, session_id, status: "stopped", updated_at: Date.now() });
  }

  /** 响应当前 Session 等待中的审批或问题。 */
  async respond_interaction(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    input: RespondSessionInteractionInput,
  ): Promise<void> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.respond(input);
  }

  /** 读取 Session 当前运行态。 */
  async get_runtime(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatRuntime> {
    return await this.read_runtime(agent_id, workspace_id, await this.get_session(agent_id, workspace_id, session_id));
  }

  /** 读取 Session 当前模型与审批模式。 */
  async get_configuration(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopSessionConfiguration> {
    return await this.read_session_configuration(workspace_id, await this.get_session(agent_id, workspace_id, session_id));
  }

  /** 解析 Federation 模型并切换当前 Session。 */
  async set_model(agent_id: string, workspace_id: string, session_id: string, model_id: string): Promise<DesktopSessionConfiguration> {
    const entry = await this.require_workspace_entry(agent_id, workspace_id);
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const model = await resolve_desktop_agent_model(this.data, model_id, entry.workspace.get_env());
    const configured_effort = this.read_session_reasoning_efforts()[get_session_key(agent_id, workspace_id, session_id)];
    const reasoning_effort = select_model_reasoning_effort(model, configured_effort);
    this.persist_session_reasoning_effort(agent_id, workspace_id, session_id, reasoning_effort);
    await session.set({ model: configure_desktop_agent_model(model, reasoning_effort) });
    this.persist_session_model_id(agent_id, workspace_id, session_id, model_id);
    this.restored_session_models.set(get_session_key(agent_id, workspace_id, session_id), model_id);
    return await this.read_session_configuration(workspace_id, session);
  }

  /** 设置当前 Session 的推理强度，并让后续 Turn 使用该档位。 */
  async set_reasoning_effort(agent_id: string, workspace_id: string, session_id: string, reasoning_effort?: string): Promise<DesktopSessionConfiguration> {
    const entry = await this.require_workspace_entry(agent_id, workspace_id);
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const model_id = (await this.read_session_configuration(workspace_id, session)).model_id;
    const model = await resolve_desktop_agent_model(this.data, model_id, entry.workspace.get_env());
    const selected_effort = select_model_reasoning_effort(model, reasoning_effort);
    await session.set({ model: configure_desktop_agent_model(model, selected_effort) });
    this.persist_session_reasoning_effort(agent_id, workspace_id, session_id, selected_effort);
    return await this.read_session_configuration(workspace_id, session);
  }

  /** 更新当前 Session 的安全审批模式。 */
  async set_approval_mode(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    approval_mode: SessionApprovalMode,
  ): Promise<DesktopSessionConfiguration> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.set({ security: { approval_mode } });
    return await this.read_session_configuration(workspace_id, session);
  }

  /** 释放 Desktop 进程拥有的全部 native Agent。 */
  async dispose(): Promise<void> {
    await this.ready_promise.catch(() => undefined);
    for (const unsubscribe of this.session_unsubscribes.values()) unsubscribe();
    this.session_unsubscribes.clear();
    for (const unsubscribe of this.group_unsubscribes.values()) unsubscribe();
    this.group_unsubscribes.clear();
    this.runtimes.clear();
    this.restored_session_models.clear();
    const results: PromiseSettledResult<unknown>[] = [];
    results.push(...await Promise.allSettled([this.city.close()]));
    results.push(...await Promise.allSettled([
      unregister_city_host(this.host_instance_id),
    ]));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length > 0) throw new AggregateError(errors, "Desktop Agent dispose failed");
  }

  /** 从本地产品配置显式创建并注册全部 Desktop Agent。 */
  private async initialize_agents(): Promise<void> {
    const initialized_agents: Agent[] = [];
    try {
      // 关键点（中文）：登记即存在。启动时把 Registry 中登记的 Workspace 全部
      // 预载进 City 索引，使 Plugin main（如 Skills）能稳定列出全部 Workspace，
      // 而不是只显示当前已被 Agent 进入过的实例。
      for (const config of this.data.workspaces.list()) {
        await this.register_workspace_in_city(config);
      }
      for (const registration of await this.plugin_loader.list_registrations()) {
        this.city.plugins.add(registration);
      }
      for (const config of this.data.agents.list()) {
        const agent = await this.create_native_agent(config);
        this.city.agents.add(agent);
        try {
          initialized_agents.push(agent);
        } catch (error) {
          await agent.dispose().catch(() => undefined);
          throw error;
        }
      }
      for (const config of this.data.groups.list()) {
        const group = this.create_runtime_group(config);
        this.city.groups.add(group);
      }
      await register_city_host({
        owner: "desktop",
        pid: process.pid,
        instance_id: this.host_instance_id,
        started_at: new Date().toISOString(),
      });
    } catch (error) {
      await Promise.allSettled(initialized_agents.map(async (agent) => {
        await agent.dispose();
      }));
      throw error;
    }
  }

  /** 把 Registry 中的 Workspace 登记进 City 索引；已存在时直接返回。 */
  private async register_workspace_in_city(config: LocalWorkspaceConfig): Promise<void> {
    if (this.city.workspaces.get(config.workspace_id)) return;
    this.city.workspaces.add(await create_desktop_workspace(this.data, config));
  }

  /** 确保 Desktop catalog 中的 Plugin 已由 City 持有。 */
  private async provide_plugin(plugin_id: string): Promise<void> {
    const registration = await this.plugin_loader.load_plugin_registration(plugin_id);
    if (!registration) throw new Error(`Plugin does not provide main capability: ${plugin_id}`);
    this.city.plugins.add(registration);
  }

  /** 显式装配一个 Desktop native Agent。 */
  private async create_native_agent(config: LocalAgentConfig): Promise<Agent> {
    const [model, tools] = await Promise.all([
      Promise.resolve(create_desktop_agent_model(this.data, config, resolve_desktop_city_env(this.data))),
      Promise.resolve(create_desktop_agent_tools()),
    ]);
    return new Agent({
      id: config.agent_id,
      name: config.name,
      description: config.description,
      instruction: config.instruction,
      model,
      tools,
    });
  }

  /** 根据本地 Group 定义创建运行时 Group。 */
  private create_runtime_group(config: LocalGroupConfig): Group {
    const members = config.member_agent_ids.map((agent_id) => this.require_native_agent(agent_id));
    return new Group({
      id: config.group_id,
      name: config.name,
      instruction: config.instruction || undefined,
      model: create_desktop_group_model(this.data, config.model_id, resolve_desktop_city_env(this.data)),
      members,
    });
  }

  /** 读取 Session，并确保实时 mutation 只订阅一次；孤儿 Session 仅允许只读恢复历史。 */
  private async get_session(agent_id: string, workspace_id: string, session_id: string): Promise<AgentSession> {
    const config = this.data.workspaces.get(workspace_id);
    if (config) {
      const entry = await this.require_workspace_entry(agent_id, workspace_id);
      const session = await this.require_native_agent(agent_id).sessions.get(
        session_id,
        "chat",
        { workspace: entry.workspace },
      );
      this.observe_session(agent_id, workspace_id, session);
      return session;
    }
    // 孤儿 Session：其 Workspace 已从 Registry 移除，不登记也不订阅实时事件，
    // 只允许打开查看历史；发送前必须由用户重新绑定 Workspace。
    return await this.get_orphan_session(agent_id, workspace_id, session_id);
  }

  /** 恢复孤儿 Session 的只读实例；不写入 Registry，不产生任何副作用。 */
  private async get_orphan_session(agent_id: string, workspace_id: string, session_id: string): Promise<AgentSession> {
    const agent = this.require_native_agent(agent_id);
    const existing_entry = get_workspace_entry(agent, workspace_id);
    if (existing_entry) {
      return await agent.sessions.get(session_id, "chat", { workspace: existing_entry.workspace });
    }
    return await agent.sessions.get(session_id, "chat", { workspace: await this.get_orphan_workspace(workspace_id) });
  }

  /** 为已移除登记的孤儿 Workspace 创建内存实例；使用默认目录，并纳入 City 索引以通过宿主校验。 */
  private async get_orphan_workspace(workspace_id: string) {
    const existing = this.city.workspaces.get(workspace_id);
    if (existing) return existing;
    const workspace_path = path.join(this.data.root_path, "workspaces", "app");
    await mkdir(workspace_path, { recursive: true });
    const orphan_config: LocalWorkspaceConfig = {
      workspace_id,
      workspace_path,
      name: workspace_id,
      created_at: "",
      updated_at: "",
    };
    return this.city.workspaces.add(await create_desktop_workspace(this.data, orphan_config));
  }

  /** 读取即将执行模型调用的 Session；孤儿 Session 必须先绑定 Workspace 才能执行。 */
  private async get_execution_session(agent_id: string, workspace_id: string, session_id: string): Promise<AgentSession> {
    if (!this.data.workspaces.get(workspace_id)) {
      throw new Error("关联 Workspace 未添加，请先选择 Workspace 后再发送");
    }
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await this.restore_session_model(agent_id, workspace_id, session);
    return session;
  }

  /** 建立 SDK Session 到 Renderer 的唯一事件桥。 */
  private observe_session(agent_id: string, workspace_id: string, session: AgentSession): void {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    if (this.session_unsubscribes.has(session_key)) return;
    const unsubscribe = session.subscribe((mutation: SessionMutation) => {
      this.events.mutation({ agent_id, workspace_id, session_id: session.id, mutation });
      if (mutation.variant === "part" && mutation.type === "interaction") {
        const current = this.runtimes.get(session_key);
        // interaction 的收口事件可能晚于 Turn finish 到达，终态不能被回退为 streaming。
        if (
          !current
          || current.status === "completed"
          || current.status === "failed"
          || current.status === "stopped"
          || (current.turn_id && mutation.turn_id && current.turn_id !== mutation.turn_id)
        ) return;
        this.update_runtime({
          agent_id,
          workspace_id,
          session_id: session.id,
          status: mutation.part.status === "pending" ? "waiting_input" : "streaming",
          ...(mutation.turn_id ? { turn_id: mutation.turn_id } : current?.turn_id ? { turn_id: current.turn_id } : {}),
          updated_at: mutation.created_at,
        });
      }
      if (mutation.variant !== "turn") return;
      this.update_runtime({
        agent_id,
        workspace_id,
        session_id: session.id,
        status: mutation.type === "start"
          ? "streaming"
          : mutation.status === "completed"
            ? "completed"
            : mutation.status === "stopped"
              ? "stopped"
              : "failed",
        turn_id: mutation.turn_id,
        ...(mutation.error ? { error: mutation.error } : {}),
        updated_at: mutation.created_at,
      });
    });
    this.session_unsubscribes.set(session_key, unsubscribe);
  }

  /** 释放一个 Session 的订阅、运行态和 Desktop 模型覆盖。 */
  private release_session_projection(agent_id: string, workspace_id: string, session_id: string): void {
    const session_key = get_session_key(agent_id, workspace_id, session_id);
    this.session_unsubscribes.get(session_key)?.();
    this.session_unsubscribes.delete(session_key);
    this.runtimes.delete(session_key);
    this.restored_session_models.delete(session_key);
    const model_ids = this.read_session_model_ids();
    if (session_key in model_ids) {
      delete model_ids[session_key];
      this.data.settings.set(session_model_settings_key, model_ids);
    }
    const reasoning = this.read_session_reasoning_efforts();
    if (session_key in reasoning) {
      delete reasoning[session_key];
      this.data.settings.set(session_reasoning_settings_key, reasoning);
    }
  }

  /** 从 SDK status 恢复应用重启或首次进入时的运行态。 */
  private async read_runtime(agent_id: string, workspace_id: string, session: AgentSession): Promise<DesktopChatRuntime> {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    const current = this.runtimes.get(session_key);
    if (current) return current;
    const status = await session.status();
    const runtime: DesktopChatRuntime = {
      agent_id,
      workspace_id,
      session_id: session.id,
      status: status.state === "running" ? "streaming" : "idle",
      ...(status.active_turn_id ? { turn_id: status.active_turn_id } : {}),
      updated_at: Date.now(),
    };
    this.runtimes.set(session_key, runtime);
    return runtime;
  }

  /** 把 SDK Session 配置收敛成可序列化 Renderer 投影。 */
  private async read_session_configuration(workspace_id: string, session: AgentSession): Promise<DesktopSessionConfiguration> {
    const status = await session.status();
    const agent_config = this.data.agents.get(session.agent_id);
    const default_model_id = typeof agent_config?.execution?.model_id === "string" ? agent_config.execution.model_id : "";
    const session_key = get_session_key(session.agent_id, workspace_id, session.id);
    const configured_model = session.config.model as { modelId?: unknown } | undefined;
    const runtime_model_id = typeof configured_model?.modelId === "string" ? configured_model.modelId : "";
    const reasoning_effort = this.read_session_reasoning_efforts()[session_key];
    return {
      model_id: runtime_model_id || this.read_session_model_ids()[session_key] || default_model_id,
      ...(reasoning_effort ? { reasoning_effort } : {}),
      approval_mode: status.security.approval_mode,
    };
  }

  /** 恢复 Desktop 为 Session 单独保存的模型覆盖。 */
  private async restore_session_model(agent_id: string, workspace_id: string, session: AgentSession): Promise<void> {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    const model_id = this.read_session_model_ids()[session_key];
    if (!model_id || this.restored_session_models.get(session_key) === model_id) return;
    const entry = await this.require_workspace_entry(agent_id, workspace_id);
    const model = await resolve_desktop_agent_model(this.data, model_id, entry.workspace.get_env());
    const reasoning_effort = select_model_reasoning_effort(model, this.read_session_reasoning_efforts()[session_key]);
    this.persist_session_reasoning_effort(agent_id, workspace_id, session.id, reasoning_effort);
    await session.set({ model: configure_desktop_agent_model(model, reasoning_effort) }, { persist_action: false });
    this.restored_session_models.set(session_key, model_id);
  }

  /** 读取按 Agent + Session 索引的稳定模型 ID。 */
  private read_session_model_ids(): Record<string, string> {
    const value = this.data.settings.get<Record<string, unknown>>(session_model_settings_key) ?? {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, model_id]) => typeof model_id === "string" && model_id.trim() ? [[key, model_id.trim()]] : []));
  }

  /** 保存一个 Session 的稳定模型 ID。 */
  private persist_session_model_id(agent_id: string, workspace_id: string, session_id: string, model_id: string): void {
    const current = this.read_session_model_ids();
    this.data.settings.set(session_model_settings_key, {
      ...current,
      [get_session_key(agent_id, workspace_id, session_id)]: model_id,
    });
  }

  /** 读取按 Agent + Session 索引的推理档位覆盖。 */
  private read_session_reasoning_efforts(): Record<string, string> {
    const value = this.data.settings.get<Record<string, unknown>>(session_reasoning_settings_key) ?? {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, effort]) => typeof effort === "string" && effort.trim() ? [[key, effort.trim()]] : []));
  }

  /** 保存一个 Session 的推理档位覆盖。 */
  private persist_session_reasoning_effort(agent_id: string, workspace_id: string, session_id: string, reasoning_effort?: string): void {
    const current = this.read_session_reasoning_efforts();
    const key = get_session_key(agent_id, workspace_id, session_id);
    if (reasoning_effort?.trim()) current[key] = reasoning_effort.trim(); else delete current[key];
    this.data.settings.set(session_reasoning_settings_key, current);
  }

  /** 保存并广播 Session 运行态。 */
  private update_runtime(runtime: DesktopChatRuntime): void {
    this.runtimes.set(get_session_key(runtime.agent_id, runtime.workspace_id, runtime.session_id), runtime);
    this.events.runtime({ runtime });
  }

  /** 读取由 Desktop City 持有的本地 Agent。 */
  private require_native_agent(agent_id: string): Agent {
    const agent = this.city.agents.get(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 读取当前 City 持有的 Group。 */
  private require_group(group_id: string): Group {
    const group = this.city.groups.get(String(group_id || "").trim());
    if (!group) throw new Error(`Group not found: ${group_id}`);
    return group;
  }

  /** 读取当前 City Group 对应的本地定义。 */
  private require_group_config(group_id: string): LocalGroupConfig {
    const config = this.data.groups.get(String(group_id || "").trim());
    if (!config) throw new Error(`Group config not found: ${group_id}`);
    return config;
  }

  /** 为 Desktop 当前打开的 Group 建立唯一消息订阅。 */
  private subscribe_group(group_session: GroupSessionContract): void {
    const cache_key = get_group_session_key(group_session.group_id, group_session.id);
    if (this.group_unsubscribes.has(cache_key)) return;
    const unsubscribe = group_session.subscribe((event) => {
      this.events.group_event(event.type === "message"
        ? { group_id: group_session.group_id, session_id: group_session.id, type: "message", message: to_desktop_group_message(event.message) }
        : event.type === "title"
          ? { group_id: group_session.group_id, session_id: group_session.id, type: "title", title: event.title }
        : event.type === "interaction"
          ? { group_id: group_session.group_id, session_id: group_session.id, type: "interaction", agent_id: event.agent_id, request: event.request }
        : {
          group_id: group_session.group_id,
          session_id: group_session.id,
          type: "status",
          ...(event.turn_id ? { turn_id: event.turn_id } : {}),
          ...(event.message_id ? { message_id: event.message_id } : {}),
          ...(event.dispatched_member_ids ? { dispatched_member_ids: [...event.dispatched_member_ids] } : {}),
          phase: event.phase,
          members: event.members.map((status) => ({ ...status })),
        });
    });
    this.group_unsubscribes.set(cache_key, unsubscribe);
  }

  /** 获取或创建 Group 指定或当前活动的群聊上下文。 */
  private async require_group_session(group: Group, session_id?: string): Promise<GroupSessionContract> {
    const resolved_session_id = String(session_id || this.active_group_session_ids.get(group.id) || "").trim();
    const existing = resolved_session_id
      ? this.group_sessions_by_key.get(get_group_session_key(group.id, resolved_session_id))
      : undefined;
    if (existing) return existing;
    const summaries = await group.sessions.list();
    const target_id = resolved_session_id || summaries[0]?.id;
    const target_summary = summaries.find((summary) => summary.id === target_id);
    const workspace = target_summary?.workspace_id
      ? await this.require_group_workspace(target_summary.workspace_id)
      : undefined;
    const loaded = target_id ? await group.sessions.get(target_id, workspace ? { workspace } : undefined) : null;
    if (resolved_session_id && !loaded) {
      throw new Error(`GroupSession not found: ${resolved_session_id}`);
    }
    const created = loaded || await group.sessions.create();
    this.cache_group_session(created);
    this.active_group_session_ids.set(group.id, created.id);
    return created;
  }

  private cache_group_session(group_session: GroupSessionContract): void {
    this.group_sessions_by_key.set(get_group_session_key(group_session.group_id, group_session.id), group_session);
  }

  private remove_group_session_cache(group_id: string, session_id?: string): void {
    const prefix = `${group_id}:`;
    for (const key of [...this.group_sessions_by_key.keys()]) {
      if (key.startsWith(prefix) && (!session_id || key === get_group_session_key(group_id, session_id))) {
        this.group_sessions_by_key.delete(key);
        this.group_unsubscribes.get(key)?.();
        this.group_unsubscribes.delete(key);
      }
    }
    if (!session_id) this.active_group_session_ids.delete(group_id);
  }

  /** 解析 GroupSession 所需的 Workspace 资源；登记缺失时回退到孤儿实例，避免点击已移除 Workspace 的 Group 直接报错。 */
  private async require_group_workspace(workspace_id: string) {
    const config = this.data.workspaces.get(workspace_id);
    if (!config) return await this.get_orphan_workspace(workspace_id);
    return this.city.workspaces.get(workspace_id)
      ?? this.city.workspaces.add(await create_desktop_workspace(this.data, config));
  }

  /** 按需让 Desktop Agent 进入指定 Workspace。 */
  private async require_workspace_entry(agent_id: string, workspace_id: string) {
    const agent = this.require_native_agent(agent_id);
    const existing = get_workspace_entry(agent, workspace_id);
    if (existing) return existing;
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    const workspace = this.city.workspaces.get(workspace_id)
      ?? this.city.workspaces.add(await create_desktop_workspace(this.data, config));
    return create_workspace_entry(agent, workspace);
  }
}

/** 根据常见 Workspace 文件扩展名推断 MIME 类型。 */
function workspace_file_media_type(file_name: string): string {
  const extension = path.extname(file_name).toLowerCase();
  return ({ ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json", ".js": "text/javascript", ".ts": "text/typescript", ".tsx": "text/typescript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

/** 将 Renderer 路径转换为安全、跨平台一致的 Workspace 相对路径。 */
function normalize_workspace_relative_path(relative_path: string): string {
  const value = String(relative_path || "").trim().replaceAll("\\", "/");
  if (!value) return "";
  if (path.posix.isAbsolute(value)) throw new Error("Workspace path must be relative");
  const normalized_path = path.posix.normalize(value);
  if (normalized_path === ".." || normalized_path.startsWith("../")) throw new Error("Workspace path is invalid");
  return normalized_path === "." ? "" : normalized_path;
}

/** 使模型切换后的推理档位始终来自该模型公开的档位列表。 */
function select_model_reasoning_effort(model: unknown, requested?: string): string | undefined {
  const reasoning = (model as { reasoning?: { efforts?: Array<{ id?: string }>; default_effort?: string } }).reasoning;
  const efforts = reasoning?.efforts?.map((effort) => effort.id).filter((id): id is string => Boolean(id?.trim())) ?? [];
  if (efforts.length === 0) return undefined;
  if (requested && efforts.includes(requested)) return requested;
  return reasoning?.default_effort && efforts.includes(reasoning.default_effort) ? reasoning.default_effort : efforts[0];
}

/** 把 Registry Agent 收敛成 Renderer 所需摘要。 */
function to_desktop_agent_summary(record: Pick<LocalAgentConfig, "agent_id" | "name" | "description" | "version" | "execution">, avatar_url?: string): DesktopAgentSummary {
  return {
    agent_id: record.agent_id,
    name: record.name,
    description: record.description,
    ...(avatar_url ? { avatar_url } : {}),
    model_id: typeof record.execution?.model_id === "string" ? record.execution.model_id : "",
    version: record.version,
  };
}

/** 把 Registry Workspace 收敛成 Renderer 所需摘要。 */
async function to_desktop_workspace_summary(record: LocalWorkspaceConfig): Promise<DesktopWorkspaceSummary> {
  return {
    workspace_id: record.workspace_id,
    workspace_path: record.workspace_path,
    name: record.name,
    readme: await read_workspace_readme(record.workspace_path),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/** 读取 Workspace 根目录 README.md；文件不存在时视为空内容。 */
async function read_workspace_readme(workspace_path: string): Promise<string> {
  try {
    return await readFile(path.join(workspace_path, "README.md"), "utf8");
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw reason;
  }
}

/** 把 SDK Group 收敛成 Renderer 所需的可序列化摘要。 */
async function to_desktop_group_summary(
  group: Group,
  model_id: string,
  session_summaries: readonly GroupSessionSummary[] = [],
  active_session_id?: string,
): Promise<DesktopGroupSummary> {
  const active_summary = session_summaries.find((session) => session.id === active_session_id) || session_summaries[0];
  return {
    group_id: group.id,
    name: group.name,
    model_id,
    ...(group.instruction ? { instruction: group.instruction } : {}),
    members: group.members.map((member) => ({ agent_id: member.id })),
    message_count: active_summary?.message_count || 0,
    sessions: session_summaries.map(to_desktop_group_session_summary),
    ...(active_summary ? { active_session_id: active_summary.id } : {}),
  };
}

/** 把 SDK GroupSession 摘要投影为 Desktop 列表项。 */
function to_desktop_group_session_summary(summary: GroupSessionSummary): DesktopGroupSessionSummary {
  return {
    session_id: summary.id,
    title: summary.title || "新对话",
    created_at: summary.created_at,
    updated_at: summary.updated_at,
    message_count: summary.message_count,
    ...(summary.workspace_id ? { workspace_id: summary.workspace_id } : {}),
    ...(summary.preview_text ? { preview_text: summary.preview_text } : {}),
  };
}

function get_group_session_key(group_id: string, session_id: string): string {
  return `${group_id}:${session_id}`;
}

/** 把 SDK GroupMessage 收敛成安全 IPC 消息。 */
function to_desktop_group_message(message: import("@downcity/agent").GroupMessage): DesktopGroupMessage {
  return {
    message_id: message.id,
  author_type: message.sender_type,
  ...(message.sender_id !== "user" && message.sender_id !== "system" ? { author_id: message.sender_id } : {}),
    text: message.text,
    created_at: message.created_at,
  };
}

/** 把 SDK Session 摘要投影为 Desktop 导航模型。 */
function to_desktop_session_summary(root_path: string, session: AgentSessionSummary, archived = false): DesktopSessionSummary {
  return {
    session_id: session.session_id,
    session_path: path.join(root_path, "agents", session.agent_id, archived ? "archived-sessions" : "sessions", session.origin.type, session.session_id),
    title: session.title || "新会话",
    preview_text: session.preview_text || "",
    created_at: session.created_at || 0,
    updated_at: session.updated_at || session.created_at || 0,
    message_count: session.message_count,
    ...(session.workspace_id ? { workspace_id: session.workspace_id } : {}),
    executing: Boolean(session.executing),
  };
}

/** 生成不会与其他 Agent Session 冲突的主进程缓存键。 */
function get_session_key(agent_id: string, workspace_id: string, session_id: string): string {
  return `${agent_id}:${workspace_id}:${session_id}`;
}

/** 把未知失败统一转换为可序列化文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

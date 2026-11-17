/** Session 管理用例；地址固定为 Agent/category/完整 ID，纯浏览不恢复 executor 或改目录。 */
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AgentSessionBrowser, type AgentSession, type AgentSessionInfo } from "@downcity/agent";
import { read_saved_session_model } from "./SavedSessionModel.js";
import type { SessionReadView } from "@downcity/agent";
import type { ResourceDependencies } from "./types.js";
import { require_agent_id, require_resource_value, require_workspace_id, ResourceError } from "./ResourceError.js";

/** 三个入口共享的 Session 浏览、执行、停止和归档实现。 */
export class SessionResources {
  /** 宿主存活期间保留分页身份；离线 client 每次用例释放。 */
  private readonly browsers = new Map<string, AgentSessionBrowser>();

  constructor(private readonly dependencies: ResourceDependencies) {}

  /** 释放快照资源，不操作 Session 生命周期。 */
  async dispose(): Promise<void> {
    const browsers = [...this.browsers.values()]; this.browsers.clear();
    const results = await Promise.allSettled(browsers.map(browser => browser.dispose()));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Session browse disposal failed");
  }

  /** 新普通工作会话；不伪造执行来源、不提交 prompt。 */
  async create(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const host = this.require_host();
    return await this.dependencies.coordinator.mutate(async () => {
      const agent = host.city.agents.get(agent_id);
      if (!agent) throw new ResourceError("resource_not_found", `Agent not loaded: ${agent_id}`, 3);
      const config = await this.resolve_workspace(input);
      this.dependencies.coordinator.assert_available(agent_id, config.workspace_id);
      const workspace = await host.resolve_workspace(config);
      const session = await agent.sessions.create({ workspace, inherit_workspace: false });
      this.invalidate(agent_id);
      return { session: project_session(await session.get_info(), false) };
    });
  }

  /** active/archived 独立分页；离线只提供首页而不伪造可持续游标。 */
  async list(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    require_resource_value(!(input.archived && input.origin_type !== undefined), "Archived lists do not support origin_type");
    const page = await this.browser(agent_id).list({ category, limit: integer_option(input.limit, 50, 1, 200), ...(typeof input.workspace === "string" ? { workspace_id: input.workspace } : {}), ...(typeof input.query === "string" ? { query: input.query } : {}), ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}), ...(typeof input.origin_type === "string" ? { origin_type: input.origin_type } : {}) }, input.archived === true);
    const runtime = this.dependencies.host?.city.agents.get(agent_id);
    return { ...page, items: await Promise.all(page.items.map(async (info) => ({ ...project_session(info, input.archived === true), runtime: await this.observe(runtime?.sessions.peek(info.session_id, category)) }))), pagination_available: true, next_cursor: page.next_cursor ?? null };
  }

  /** 历史/归档/孤儿会话均可读取，当前状态只观察已有内存实例。 */
  async get(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    const session_id = this.session_id(input);
    const view = await this.read_view(input);
    const metadata = view.metadata;
    const cached = view.archived ? undefined : this.dependencies.host?.city.agents.get(agent_id)?.sessions.peek(session_id, category);
    const configuration = await this.browser(agent_id).configuration(view.session_id);
    const model_binding = configuration.model_binding ? JSON.parse(configuration.model_binding) as import("@downcity/agent").SessionModelBinding : undefined;
    const saved_model_id = !view.archived && this.dependencies.workspaces ? read_saved_session_model(this.dependencies.root_path, metadata, this.dependencies.immutable) : undefined;
    return { session: { ...project_session(metadata, view.archived), model_binding: model_binding ?? null, saved_model_override: saved_model_id ?? null, model_selection_required: !(model_binding?.override_model_id ?? saved_model_id ?? model_binding?.default_model_id) }, runtime: await this.observe(cached), pending_interaction_count: (await view.interactions()).length };
  }

  /** canonical Message 页；直接贯通 SDK 解码，不展开附件。 */
  async history(input: Record<string, unknown>) {
    const view = await this.read_view(input);
    return await view.messages({ limit: integer_option(input.limit, 50, 1, 200), ...(input.before_sequence !== undefined ? { before_sequence: integer_option(input.before_sequence, 1, 1, Number.MAX_SAFE_INTEGER) } : {}) });
  }

  /** 接收与完成分开，no_wait 关闭客户端后由宿主持有执行。 */
  async send(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    const session_id = this.session_id(input);
    require_resource_value(typeof input.message === "string" && input.message.trim(), "message must not be empty");
    const request_id = input.request_id === undefined ? randomUUID() : String(input.request_id);
    require_resource_value(request_id.trim(), "request_id must not be empty");
    const host = this.require_host();
    const receipt = await this.dependencies.coordinator.mutate(async () => {
      const view = await this.browser(agent_id).get(session_id, category);
      if (view.archived) throw new ResourceError("dependency_conflict", "Archived Sessions cannot execute", 4);
      const workspace_id = view.metadata.workspace_id;
      if (!workspace_id || !this.dependencies.workspaces?.get(workspace_id)) throw new ResourceError("workspace_missing", "Session Workspace must be registered before execution", 4);
      await this.validate_workspace(input, workspace_id);
      this.dependencies.coordinator.assert_available(agent_id, workspace_id);
      const agent = host.city.agents.get(agent_id);
      if (!agent) throw new ResourceError("resource_not_found", `Agent not loaded: ${agent_id}`, 3);
      const workspace_config = this.dependencies.workspaces!.get(workspace_id)!;
      const workspace = await host.resolve_workspace(workspace_config);
      const session = await agent.sessions.get(session_id, category, { workspace });
      await host.prepare_session?.(agent_id, session);
      const model_binding = await this.browser(agent_id).model_binding(session_id, category);
      const saved_model_id = !model_binding?.override_model_id ? read_saved_session_model(this.dependencies.root_path, view.metadata, false) : undefined;
      if (saved_model_id && session.get("model")?.id !== saved_model_id) {
        const model = await host.resolve_model(saved_model_id);
        if (model) await session.set({ model }, { persist_action: false });
      }
      if (!session.get("model")) throw new ResourceError("validation_error", "Select a Session model explicitly before sending; historical model labels cannot reconstruct its original default", 2);
      const handle = await session.prompt({ query: input.message as string, request_id });
      this.invalidate(agent_id);
      return { session, handle };
    });
    const data = { session_address: { agent_id, category, session_id }, request_id, turn_id: receipt.handle.id, accepted: true, completed: false, result: null as unknown };
    if (input.no_wait) return data;
    const timeout_ms = integer_option(input.wait_timeout_ms, 300_000, 1, Number.MAX_SAFE_INTEGER);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ResourceError("operation_timeout", "Turn wait timed out; execution continues in the host", 7, false, data)), timeout_ms);
        let checking = false;
        interval = setInterval(() => {
          if (checking) return;
          checking = true;
          void receipt.session.interactions().then((interactions) => {
            if (interactions.length) reject(new ResourceError("interaction_required", "Turn is waiting for user interaction in the host", 4, false, { ...data, interaction_id: interactions[0]!.interaction_id, interaction_type: interactions[0]!.type }));
          }).catch(reject).finally(() => { checking = false; });
        }, 250);
      });
      const result = await Promise.race([receipt.handle.finished, interrupted]);
      const completed = { ...data, completed: true, result };
      if (!result.success) throw new ResourceError("turn_failed", result.error ?? "Turn failed or was stopped", 8, false, completed);
      return completed;
    } finally { clearTimeout(timer); clearInterval(interval); }
  }

  /** 断线恢复只读事实；与输入接收串行，避免把尚在接收中的请求误判未接收。 */
  async receipt(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    const session_id = this.session_id(input);
    require_resource_value(typeof input.request_id === "string" && input.request_id.trim(), "request_id is required");
    return await this.dependencies.coordinator.mutate(async () => {
      const receipt = await this.browser(agent_id).receipt(session_id, category, input.request_id as string);
      const cached = this.dependencies.host?.city.agents.get(agent_id)?.sessions.peek(session_id, category);
      const status = await cached?.status();
      return { ...receipt, session_address: { agent_id, category, session_id }, request_id: input.request_id, execution_state: receipt.completed ? "completed" : receipt.accepted ? status?.live_execution ? "running" : "interrupted" : "not_found" };
    });
  }

  /** 默认先读取当前 Turn，再条件停止；从未加载的空闲历史无需恢复。 */
  async stop(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    const session_id = this.session_id(input);
    const host = this.require_host();
    await this.browser(agent_id).get(session_id, category);
    const session = host.city.agents.get(agent_id)?.sessions.peek(session_id, category);
    if (!session) return { stopped: false, turn_id: null, cancelled_queued_prompts: 0, reason: "idle" };
    const status = await session.status();
    const expected = typeof input.turn_id === "string" ? input.turn_id : status.active_turn_id;
    if (expected && expected !== status.active_turn_id) throw new ResourceError("turn_changed", "Current Turn changed; refresh before stopping", 4);
    if (!expected) return { stopped: false, turn_id: null, cancelled_queued_prompts: 0, reason: "idle" };
    return await session.stop(expected);
  }

  /** 归档递归由 SDK 负责；失败明确表示可能部分提交，不承诺原子回滚。 */
  async archive(input: Record<string, unknown>) {
    const agent_id = this.agent_id(input);
    const category = this.category(input);
    const session_id = this.session_id(input);
    const host = this.require_host();
    return await this.dependencies.coordinator.mutate(async () => {
      const agent = host.city.agents.get(agent_id);
      if (!agent) throw new ResourceError("resource_not_found", `Agent not loaded: ${agent_id}`, 3);
      try {
        const root_result = await agent.sessions.archive({ id: session_id, category,
          ...(typeof input.operation_id === "string" ? { operation_id: input.operation_id } : {}),
          ...(typeof input.root_session_id === "string" ? { root_session_id: input.root_session_id } : {}),
        });
        return { session_address: { agent_id, category, session_id }, root_result, changed: root_result.changed ?? false };
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "session_busy") throw new ResourceError("resource_busy", error.message, 4);
        const handle = error as { operation_id?: string; root_session_id?: string; plan_fingerprint?: string };
        throw new ResourceError("partial_failure", "Session archive incomplete; resume the original operation_id", 9, false, {
          partial_state: "unknown", session_address: { agent_id, category, session_id }, operation_id: handle.operation_id,
          root_session_id: handle.root_session_id, plan_fingerprint: handle.plan_fingerprint,
        });
      } finally { this.invalidate(agent_id); }
    });
  }

  private browser(agent_id: string): AgentSessionBrowser {
    if (!this.dependencies.agents.get(agent_id) && !this.dependencies.host?.city.agents.get(agent_id)) throw new ResourceError("resource_not_found", `Agent not found: ${agent_id}`, 3);
    let browser = this.browsers.get(agent_id);
    if (!browser) {
      browser = new AgentSessionBrowser({ agent_id, storage_root_path: path.join(this.dependencies.root_path, "agents", agent_id), immutable: this.dependencies.immutable });
      this.browsers.set(agent_id, browser);
    }
    return browser;
  }

  /** 归档参数必须显式携带稳定UUID；活动请求不回落归档。 */
  private async read_view(input: Record<string, unknown>): Promise<SessionReadView> {
    const browser = this.browser(this.agent_id(input));
    if (input.archived === true) {
      return await browser.get_archived({ session_id: this.session_id(input),
        ...(typeof input.category === "string" ? { category: this.category(input) } : {}),
      });
    }
    return await browser.get(this.session_id(input), this.category(input));
  }

  private invalidate(agent_id: string): void { this.browsers.get(agent_id)?.invalidate(); }
  private agent_id(input: Record<string, unknown>): string { require_agent_id(input.agent); return input.agent; }
  private session_id(input: Record<string, unknown>): string { require_resource_value(typeof input.session_id === "string" && input.session_id.trim(), "A complete Session ID is required"); return input.session_id; }
  private category(input: Record<string, unknown>): string { const category = input.category ?? "work"; require_resource_value(category === "chat" || category === "work", "category must be chat or work"); return category; }
  private require_host() { if (!this.dependencies.host) throw new ResourceError("host_offline", "Start City explicitly before Session execution or lifecycle operations", 5); return this.dependencies.host; }

  private async resolve_workspace(input: Record<string, unknown>) {
    require_resource_value(!(input.workspace !== undefined && input.workspace_path !== undefined), "workspace and workspace_path are mutually exclusive");
    let config;
    if (input.workspace !== undefined) { require_workspace_id(input.workspace); config = this.dependencies.workspaces?.get(input.workspace); }
    else if (typeof input.workspace_path === "string") config = this.dependencies.workspaces?.get_by_path(await fs.realpath(path.resolve(input.workspace_path)));
    else throw new ResourceError("usage_error", "An explicit Workspace is required", 2);
    if (!config) throw new ResourceError("workspace_missing", "Workspace is not registered", 4);
    return config;
  }

  private async validate_workspace(input: Record<string, unknown>, workspace_id: string): Promise<void> {
    if (input.workspace !== undefined || input.workspace_path !== undefined) {
      if ((await this.resolve_workspace(input)).workspace_id !== workspace_id) throw new ResourceError("dependency_conflict", "Workspace does not match the persisted Session directory", 4);
    }
  }

  private async observe(session?: AgentSession) {
    if (!this.dependencies.host) return { state: "unknown", active_turn_id: null, observed_at: new Date().toISOString() };
    const status = await session?.status();
    return { state: status?.state ?? "idle", active_turn_id: status?.active_turn_id ?? null, observed_at: new Date().toISOString() };
  }
}

/** SDK 时间戳只在资源 DTO 边界转换，canonical history 保持原格式。 */
function project_session(info: Pick<AgentSessionInfo, "agent_id" | "session_id" | "origin"> & Partial<AgentSessionInfo>, archived: boolean) {
  return { agent_id: info.agent_id, category: info.origin.category, session_id: info.session_id, origin: info.origin, workspace_id: info.workspace_id ?? null, title: info.title ?? null, preview_text: info.preview_text ?? null, message_count: info.message_count ?? 0, model_label: info.model_label ?? null, created_at: info.created_at === undefined ? null : new Date(info.created_at).toISOString(), updated_at: info.updated_at === undefined ? null : new Date(info.updated_at).toISOString(), timezone: info.timezone ?? null, archived };
}

/** 严格参数校验，不静默截断页数或超时。 */
function integer_option(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  require_resource_value(Number.isSafeInteger(numeric) && numeric >= minimum && numeric <= maximum, `Expected an integer between ${minimum} and ${maximum}`);
  return numeric;
}

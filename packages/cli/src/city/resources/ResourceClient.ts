/**
 * CLI/TUI 共用资源客户端。先发现并握手当前 City，无宿主时只允许配置与纯历史浏览。
 * 不自动启动宿主、装配 Agent、使用默认端口或按 daemon 启动快照推断 loaded。
 */
import { read_city_host_state, type CityHostState } from "@downcity/city";
import { validate_resource_input, ResourceService, ResourceStore, ResourceCoordinator, RootLease, resolve_resource_root, request_management, ResourceError } from "@downcity/city/local";
import { read_power_agent_references } from "@downcity/powers";

/** 资源客户端的显式上下文；不修改进程环境变量。 */
export interface ResourceClientOptions {
  /** --root 优先于环境变量和用户默认目录。 */
  root?: string;
  /** 单次管理请求时限，毫秒。 */
  timeout_ms?: number;
  /** CLI 断开等待的取消信号，不发送 Session stop。 */
  abort_signal?: AbortSignal;
}

/** 薄路由客户端，业务结果由 @downcity/city/local 统一返回。 */
export class ResourceClient {
  /** 已规范化的数据根路径，适用于输出 meta。 */
  readonly root_path: string;
  /** 仅握手完成后保存，错误响应也能准确携带已验证宿主身份。 */
  private observed_host: CityHostState | null = null;

  /** 当前调用已观察事实，不能把未经核对的发现描述当作运行身份。 */
  get_meta() {
    return { root_path: this.root_path, host: this.observed_host ? { owner: this.observed_host.owner, instance_id: this.observed_host.instance_id } : null, source: this.observed_host ? "host" : "local", observed_at: new Date().toISOString() };
  }

  constructor(private readonly options: ResourceClientOptions = {}) { this.root_path = resolve_resource_root(options.root); }

  /** 执行一个白名单资源用例并附上本次已验证的宿主/观察信息。 */
  async call(method: string, input: Record<string, unknown> = {}) {
    validate_resource_input(method, input);
    const state = await read_city_host_state(this.root_path);
    if (state) {
      const handshake = await request_management(state, this.root_path, "handshake", {}, Math.min(this.options.timeout_ms ?? 5_000, 5_000), this.options.abort_signal) as typeof state;
      if (handshake.instance_id !== state.instance_id || handshake.root_identity !== state.root_identity) throw new ResourceError("host_identity_mismatch", "City identity changed during handshake", 5);
      this.observed_host = state;
      let data: unknown;
      try {
        const initializes_workspace = method === "workspace.initialize" || (method === "workspace.register" && input.initialize_dependencies === true);
        const default_timeout_ms = initializes_workspace ? 365_000 : method === "session.send" ? 305_000 : 30_000;
        data = await request_management(state, this.root_path, method, input, this.options.timeout_ms ?? default_timeout_ms, this.options.abort_signal);
      } catch (error) {
        if (method !== "session.send" || !(error instanceof ResourceError) || ![5, 7, 130].includes(error.exit_code) || typeof input.request_id !== "string") throw error;
        // 不重发 prompt。独立只读连接核对同一 request_id，原客户端取消不能取消核实。
        try {
          const verified = await new ResourceClient({ root: this.root_path, timeout_ms: 5_000 }).call("session.receipt", input);
          const receipt = verified.data as Awaited<ReturnType<ResourceService["sessions"]["receipt"]>>;
          if (receipt.completed && error.exit_code !== 130) {
            if (!receipt.result?.success) throw new ResourceError("turn_failed", receipt.result?.error ?? "Turn failed or stopped", 8, false, receipt);
            return { data: receipt, meta: verified.meta };
          }
          throw new ResourceError(error.code, error.message, error.exit_code, error.retryable, { ...receipt, outcome: receipt.accepted ? "accepted" : "not_accepted" });
        } catch (recovery_error) {
          if (recovery_error instanceof ResourceError && (recovery_error.exit_code === 8 || recovery_error.details.outcome === "accepted" || recovery_error.details.outcome === "not_accepted")) throw recovery_error;
          throw new ResourceError(error.code, error.message, error.exit_code, false, { request_id: input.request_id, session_address: { agent_id: input.agent, category: input.category ?? "work", session_id: input.session_id }, outcome: "unknown", recovery_error: recovery_error instanceof ResourceError ? recovery_error.code : "internal_error" });
        }
      }
      return { data, meta: { root_path: this.root_path, host: { owner: state.owner, instance_id: state.instance_id }, source: "host", observed_at: new Date().toISOString() } };
    }
    const readonly = ["agent.list", "agent.get", "workspace.list", "workspace.get", "session.list", "session.get", "session.history", "session.receipt", "config.token.list", "config.token.get", "config.power.get", "config.env.get"].includes(method);
    if (method.startsWith("session.") && !readonly) throw new ResourceError("host_offline", "Start City explicitly with city on or open Desktop before executing this command", 5);
    const lease = readonly ? RootLease.acquire_read(this.root_path) : RootLease.acquire_write(this.root_path);
    let store: ResourceStore | undefined;
    let service: ResourceService | undefined;
    try {
      // 租约内重查，避免离线判断与宿主启动之间的竞争。
      if (await read_city_host_state(this.root_path)) throw new ResourceError("host_unreachable", "City became active; retry against its management channel", 5, true);
      store = new ResourceStore(this.root_path, !readonly, readonly);
      const current_store = store;
      service = new ResourceService({ root_path: this.root_path, agents: store.agents, workspaces: store.workspaces, coordinator: new ResourceCoordinator(), immutable: readonly,
        agent_references: async (agent_id) => [...current_store.agent_references(agent_id), ...await read_power_agent_references(this.root_path, agent_id, readonly)],
      });
      const data = await service.dispatch(method, input);
      return { data, meta: { root_path: this.root_path, host: null, source: "local", observed_at: new Date().toISOString() } };
    } finally {
      try { await service?.dispose(); }
      finally { try { store?.close(); } finally { lease.release(); } }
    }
  }
}

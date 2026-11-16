/** 白名单资源用例组合；命令、TUI、管理通道和 Desktop IPC 不重复实现业务。 */
import { ConfigResources } from "./ConfigResources.js";
import { AgentResources } from "./AgentResources.js";
import { WorkspaceResources } from "./WorkspaceResources.js";
import { SessionResources } from "./SessionResources.js";
import type { ResourceDependencies } from "./types.js";
import type { ResourceDispatcher } from "./ManagementChannel.js";
import { validate_resource_input } from "./ResourceInput.js";
import { ResourceError, require_resource_value } from "./ResourceError.js";

/** 三类资源共享业务服务，不持有租约/DB 的释放权。 */
export class ResourceService implements ResourceDispatcher {
  /** Agent 身份配置用例。 */
  readonly agents: AgentResources;
  /** 项目登记用例。 */
  readonly workspaces: WorkspaceResources;
  /** 会话浏览与执行用例。 */
  readonly sessions: SessionResources;
  /** 既有共享配置写入口，与资源删除共用协调器。 */
  readonly config: ConfigResources;
  /** 支持的完整操作名，不允许任意函数路径访问。 */
  readonly capabilities = ["agent.list", "agent.get", "agent.create", "agent.update", "agent.delete", "workspace.register", "workspace.initialize", "workspace.list", "workspace.get", "workspace.update", "workspace.remove", "session.create", "session.list", "session.get", "session.history", "session.receipt", "session.send", "session.stop", "session.archive", "config.token.list", "config.token.get", "config.token.create", "config.token.update", "config.token.remove", "config.power.get", "config.power.set", "config.env.get", "config.env.set", "config.env.delete"];

  constructor(private readonly dependencies: ResourceDependencies) {
    if (dependencies.extensions) this.capabilities.push(...dependencies.extensions.service.capabilities);
    this.agents = new AgentResources(dependencies);
    this.workspaces = new WorkspaceResources(dependencies);
    this.sessions = new SessionResources(dependencies);
    this.config = new ConfigResources(dependencies);
  }

  /** input 只能为普通记录；每个领域用例继续检查实际字段。 */
  async dispatch(method: string, input: Record<string, unknown>): Promise<unknown> {
    require_resource_value(input && typeof input === "object" && !Array.isArray(input), "Resource input must be an object");
    if (method.startsWith("extension.") && this.dependencies.extensions) return await this.dependencies.extensions.service.dispatch(method, input);
    validate_resource_input(method, input);
    if (method.startsWith("config.")) return await this.config.call(method, input);
    const target = (): string => { require_resource_value(typeof input.id === "string", "A complete resource ID is required"); return input.id; };
    const revision = typeof input.if_revision === "string" ? input.if_revision : undefined;
    try {
      switch (method) {
        case "agent.list": return this.agents.list(input);
        case "agent.get": return await this.agents.get(target(), input.include_instruction === true);
        case "agent.create": return await this.agents.create(input);
        case "agent.update": return await this.agents.update(target(), input);
        case "agent.delete": return await this.agents.delete(target(), revision);
        case "workspace.list": return await this.workspaces.list(input);
        case "workspace.get": return await this.workspaces.get(target());
        case "workspace.register": return await this.workspaces.register(String(input.path ?? ""), typeof input.name === "string" ? input.name : undefined, input.source as import("../types/LocalConfig.js").LocalWorkspaceConfig["source"], { initialize_dependencies: input.initialize_dependencies === true, confirmed_prompt: typeof input.confirmed_prompt === "string" ? input.confirmed_prompt : undefined });
        case "workspace.initialize": return await this.workspaces.initialize(target());
        case "workspace.update": return await this.workspaces.update(target(), input.name as string, revision);
        case "workspace.remove": return await this.workspaces.remove(target(), revision);
        case "session.create": return await this.sessions.create(input);
        case "session.list": return await this.sessions.list(input);
        case "session.get": return await this.sessions.get(input);
        case "session.history": return await this.sessions.history(input);
        case "session.receipt": return await this.sessions.receipt(input);
        case "session.send": return await this.sessions.send(input);
        case "session.stop": return await this.sessions.stop(input);
        case "session.archive": return await this.sessions.archive(input);
        default: throw new ResourceError("capability_missing", `Unsupported resource operation: ${method}`, 5);
      }
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      if (error instanceof Error && "code" in error) {
        if (error.code === "session_busy") throw new ResourceError("resource_busy", error.message, 4);
        if (error.code === "turn_changed") throw new ResourceError("turn_changed", error.message, 4);
        if (error.code === "EACCES" || error.code === "EPERM") throw new ResourceError("permission_denied", "Resource access was denied", 6);
        if (error.code === "ENOENT") throw new ResourceError("resource_not_found", "Requested resource or input file does not exist", 3);
      }
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
      const mapping: Record<string, [string, number]> = {
        session_not_found: ["resource_not_found", 3], session_address_conflict: ["dependency_conflict", 4],
        session_list_cursor_invalid: ["cursor_expired", 4], session_address_changed: ["dependency_conflict", 4], session_storage_not_found: ["resource_not_found", 3], session_migration_required: ["migration_required", 5], session_list_cursor_expired: ["cursor_expired", 4], session_pagination_unavailable: ["capability_missing", 5],
        session_recovery_required: ["migration_required", 5], session_validation_error: ["validation_error", 2],
      };
      const mapped = mapping[code ?? ""];
      if (mapped) throw new ResourceError(mapped[0], (error as Error).message, mapped[1]);
      throw error;
    }
  }

  /** 只释放浏览快照；City/DB/租约按组合根逆序释放。 */
  async dispose(): Promise<void> { await this.sessions.dispose(); }
}

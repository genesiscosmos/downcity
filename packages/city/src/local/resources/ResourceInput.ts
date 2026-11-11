/** 不依赖仓储的资源参数预检，在获取写租约或创建 root 之前完成。 */
import { require_agent_id, require_workspace_id, require_resource_value } from "./ResourceError.js";

/** 只校验可确定的语法；资源存在性、CAS 与引用必须留在用例事务内检查。 */
export function validate_resource_input(method: string, input: Record<string, unknown>): void {
  if (method.startsWith("agent.")) {
    if (method === "agent.create") {
      require_resource_value(typeof input.name === "string" && input.name.trim(), "name is required");
      if (input.id !== undefined) require_agent_id(input.id);
    } else if (!["agent.list"].includes(method)) require_agent_id(input.id);
    require_resource_value(!(input.loaded && input.unloaded), "loaded and unloaded are mutually exclusive");
    require_resource_value(!(input.model !== undefined && input.unset_model), "model and unset_model are mutually exclusive");
  }
  if (method.startsWith("workspace.") && !["workspace.list", "workspace.register"].includes(method)) require_workspace_id(input.id, method === "workspace.get");
  if (method === "workspace.register") {
    if (input.source !== undefined) {
      const source = input.source as Record<string, unknown> | null;
      require_resource_value(source && source.kind === "ssh" && typeof source.host === "string" && source.host.trim(), "SSH source requires kind=ssh and host");
    }
    require_resource_value(input.initialize_dependencies === undefined || typeof input.initialize_dependencies === "boolean", "initialize_dependencies must be a boolean");
    require_resource_value(input.initialize_dependencies !== true || input.source !== undefined, "Dependency initialization requires an SSH Workspace");
  }
  if (method.startsWith("session.")) {
    require_agent_id(input.agent);
    require_resource_value(input.category === undefined || input.category === "work" || input.category === "chat", "category must be chat or work");
    if (!["session.list", "session.create"].includes(method)) require_resource_value(typeof input.session_id === "string" && input.session_id.trim() && input.session_id.trim() === input.session_id, "A complete Session ID is required");
    if (method === "session.send") require_resource_value(typeof input.message === "string" && input.message.trim(), "message must not be empty");
    if (method === "session.create") require_resource_value(input.category === undefined || input.category === "work", "Ordinary Session creation uses category work");
    require_resource_value(!(input.archived && input.origin_type !== undefined), "Archived lists do not support origin_type");
  }
  require_resource_value(!(input.workspace !== undefined && input.workspace_path !== undefined), "workspace and workspace-path are mutually exclusive");
  if (input.limit !== undefined) require_resource_value(Number.isSafeInteger(Number(input.limit)) && Number(input.limit) >= 1 && Number(input.limit) <= 200, "limit must be an integer from 1 to 200");
  if (input.before_sequence !== undefined) require_resource_value(Number.isSafeInteger(Number(input.before_sequence)) && Number(input.before_sequence) > 0, "before-sequence must be a positive integer");
}

/**
 * Memory User、Agent、Workspace 范围的稳定逻辑地址编码。
 *
 * 关键点（中文）
 * - 逻辑地址只描述「谁的数据」，与物理根目录、物理文件名无关。
 * - Agent 私有，User 与 Workspace 按可信标识隔离。
 * - Agent 使用原始 agent_id 段，它本身已经是受限标识符，可直接作为物理目录名。
 * - 写入目标只能解析为当前 AccessContext 中已经绑定的范围。
 */

import { memory_id_schema } from "./MemorySchema.js";
import { LOCAL_USER_ID } from "@downcity/city/local";
import type {
  MemoryKnowledgeAccess,
  MemoryScope,
  MemoryScopeType,
} from "@/memory/types/MemoryAccess.js";

/** Agent 标识允许的字符集合，与本地 Agent 定义保持一致。 */
const AGENT_SEGMENT_PATTERN = /^[a-z0-9_]+$/u;

/** Provider 内部解析后的范围地址。 */
export interface MemoryScopeAddress {
  /** 当前记录的持久化所有者。 */
  scope: MemoryScope;

  /** 可直接作为逻辑 memory_id 前缀的地址。 */
  prefix: string;
}

/** 返回当前调用允许读取的范围地址，顺序同时表达默认上下文优先级。 */
export function resolve_readable_memory_addresses(
  access: MemoryKnowledgeAccess,
): MemoryScopeAddress[] {
  if (is_user_access(access)) return [managed_address(access)];
  assert_access_agent(access);
  const addresses: MemoryScopeAddress[] = [create_agent_address(access.agent_id)];
  addresses.push(create_shared_address("user", LOCAL_USER_ID));
  if (access.workspace_id && access.city_memory_available) addresses.push(create_shared_address("workspace", access.workspace_id));
  return addresses;
}

/**
 * 把有限写入目标解析为真实范围地址。
 *
 * 共享范围由可信访问上下文解析，模型无法指定任意用户或项目。
 */
export function resolve_writable_memory_address(
  access: MemoryKnowledgeAccess,
  scope: MemoryScopeType,
): MemoryScopeAddress {
  if (is_user_access(access)) {
    const address = managed_address(access);
    if (scope !== address.scope.type) throw new Error("Management scope mismatch");
    return address;
  }
  assert_access_agent(access);
  if (scope === "agent") return create_agent_address(access.agent_id);
  if (scope === "user") {
    return create_shared_address("user", LOCAL_USER_ID);
  }
  if (scope === "workspace") {
    if (!access.workspace_id) {
      throw new Error("Memory scope workspace requires a Workspace");
    }
    if (!access.city_memory_available) {
      throw new Error("Memory scope workspace requires City Memory");
    }
    return create_shared_address("workspace", access.workspace_id);
  }
  throw new Error(`Unsupported Memory scope: ${String(scope)}`);
}

/** 从完整 memory_id 解析范围，并校验当前调用可读取。 */
export function resolve_readable_memory_address(
  access: MemoryKnowledgeAccess,
  memory_id: string,
): MemoryScopeAddress {
  memory_id_schema.parse(memory_id);
  const matched = resolve_readable_memory_addresses(access)
    .find((address) => memory_id.startsWith(`${address.prefix}/wiki/`));
  if (!matched) throw new Error(`Memory is outside the current access context: ${memory_id}`);
  return matched;
}

/** 创建 Agent 私有地址。 */
function create_agent_address(agent_id: string): MemoryScopeAddress {
  const segment = normalize_agent_segment(agent_id);
  return {
    scope: { type: "agent", id: segment },
    prefix: `agent/${segment}`,
  };
}

/** 创建按可信标识隔离的共享空间，标识编码不包含路径分隔符。 */
function create_shared_address(kind: "user" | "workspace", subject_id: string): MemoryScopeAddress {
  const segment = Buffer.from(subject_id, "utf8").toString("hex");
  if (!segment) throw new Error("Memory subject identity is required");
  return { scope: { type: kind, id: subject_id }, prefix: `${kind}/${segment}` };
}

/** 校验一个原始 Agent 标识可以直接作为单层逻辑地址段与物理目录名。 */
function normalize_agent_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!AGENT_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`Invalid Memory agent_id: ${value}`);
  }
  return segment;
}

/** 保证 AccessContext 与当前 Agent 绑定。 */
function assert_access_agent(access: MemoryKnowledgeAccess): void {
  if (!String(access.agent_id || "").trim()) {
    throw new Error("Memory access requires agent_id");
  }
}

/** Only the platform local User can use host ownership; no Agent identity is synthesized. */
function is_user_access(access: MemoryKnowledgeAccess): access is import("../types/MemoryAccess.js").MemoryUserAccessContext {
  if (!("authority" in access)) return false;
  if (access.authority !== "local_user" || access.user_id !== LOCAL_USER_ID || access.agent_id !== undefined
    || access.workspace_id !== undefined || access.city_memory_available !== false) {
    throw new Error("Invalid local User memory access");
  }
  return true;
}

/** 认证本地管理可显式选择已授权对象，不借用默认 Agent 执行身份。 */
function managed_address(access: import("../types/MemoryAccess.js").MemoryUserAccessContext): MemoryScopeAddress {
  const scope = access.managed_scope;
  if (!scope || scope.type === "user") {
    if (scope && scope.id !== LOCAL_USER_ID) throw new Error("Invalid local User scope");
    return create_shared_address("user", LOCAL_USER_ID);
  }
  if (scope.type === "agent") return create_agent_address(scope.id);
  if (scope.type === "workspace") return create_shared_address("workspace", scope.id);
  throw new Error(`Unsupported management Memory scope: ${String(scope.type)}`);
}

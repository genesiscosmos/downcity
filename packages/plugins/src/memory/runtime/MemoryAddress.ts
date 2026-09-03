/**
 * Memory owner/subject 的稳定逻辑地址编码。
 *
 * 关键点（中文）
 * - 原始用户、Workspace、Agent ID 不直接拼接为路径。
 * - 逻辑地址用于 memory_id 与 Store Router，不暴露任何物理根路径。
 * - 写入目标只能解析为当前 AccessContext 中已经存在的 Subject。
 */

import type {
  MemoryAccessContext,
  MemoryOwner,
  MemorySubject,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";

/** Provider 内部解析后的 owner/subject 地址。 */
export interface MemorySubjectAddress {
  /** 当前记录的持久化所有者。 */
  owner: MemoryOwner;

  /** 当前记录描述的主体。 */
  subject: MemorySubject;

  /** 可直接作为逻辑 memory_id 前缀的安全路径。 */
  prefix: string;
}

/** 把不可信标识编码为稳定、可逆的单目录段。 */
export function encode_memory_id_segment(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("Memory identity segment is required");
  return `id_${Buffer.from(normalized, "utf8").toString("base64url")}`;
}

/** 把 Memory 单目录段还原为原始标识。 */
export function decode_memory_id_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!/^id_[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error(`Invalid Memory identity segment: ${value}`);
  }
  const decoded = Buffer.from(segment.slice(3), "base64url").toString("utf8").trim();
  if (!decoded) throw new Error(`Invalid Memory identity segment: ${value}`);
  return decoded;
}

/** 返回当前调用允许读取的 Subject 地址，顺序同时表达默认上下文优先级。 */
export function resolve_readable_memory_addresses(
  access: MemoryAccessContext,
): MemorySubjectAddress[] {
  assert_access_agent(access);
  const addresses: MemorySubjectAddress[] = [];
  if (access.city_memory_available && access.user_id) {
    addresses.push(create_user_address(access.user_id));
  }
  if (access.city_memory_available && access.workspace_id) {
    addresses.push(create_workspace_address(access.workspace_id));
  }
  addresses.push(create_agent_address(access.agent_id));
  if (access.city_memory_available) addresses.push(create_city_address());
  return addresses;
}

/** 把有限写入目标解析为真实 owner/subject 地址。 */
export function resolve_writable_memory_address(
  access: MemoryAccessContext,
  target: MemoryWriteTarget,
): MemorySubjectAddress {
  assert_access_agent(access);
  if (target === "agent") return create_agent_address(access.agent_id);
  if (!access.city_memory_available) {
    throw new Error(`Memory target ${target} requires City Memory`);
  }
  if (target === "current_user") {
    if (!access.user_id) {
      throw new Error("Memory target current_user requires an authenticated user");
    }
    return create_user_address(access.user_id);
  }
  if (target === "current_workspace") {
    if (!access.workspace_id) {
      throw new Error("Memory target current_workspace requires a Workspace");
    }
    return create_workspace_address(access.workspace_id);
  }
  throw new Error(`Unsupported Memory write target: ${String(target)}`);
}

/** 从完整 memory_id 解析 owner/subject，并校验当前调用可读取。 */
export function resolve_readable_memory_address(
  access: MemoryAccessContext,
  memory_id: string,
): MemorySubjectAddress {
  const normalized = String(memory_id || "")
    .replace(/^memory:\/\/builtin\//u, "")
    .replace(/^\/+/, "")
    .trim();
  const matched = resolve_readable_memory_addresses(access)
    .find((address) => normalized === address.prefix || normalized.startsWith(`${address.prefix}/`));
  if (!matched) throw new Error(`Memory is outside the current access context: ${memory_id}`);
  return matched;
}

/** 创建 Agent 私有地址。 */
function create_agent_address(agent_id: string): MemorySubjectAddress {
  return {
    owner: { kind: "agent", agent_id },
    subject: { kind: "agent", agent_id },
    prefix: `agent/${encode_memory_id_segment(agent_id)}`,
  };
}

/** 创建 City User 地址。 */
function create_user_address(user_id: string): MemorySubjectAddress {
  return {
    owner: { kind: "city" },
    subject: { kind: "user", user_id },
    prefix: `city/users/${encode_memory_id_segment(user_id)}`,
  };
}

/** 创建 City Workspace 地址。 */
function create_workspace_address(workspace_id: string): MemorySubjectAddress {
  return {
    owner: { kind: "city" },
    subject: { kind: "workspace", workspace_id },
    prefix: `city/workspaces/${encode_memory_id_segment(workspace_id)}`,
  };
}

/** 创建 City Shared 地址。 */
function create_city_address(): MemorySubjectAddress {
  return {
    owner: { kind: "city" },
    subject: { kind: "city" },
    prefix: "city/shared",
  };
}

/** 保证 AccessContext 与当前 Agent 绑定。 */
function assert_access_agent(access: MemoryAccessContext): void {
  if (!String(access.agent_id || "").trim()) {
    throw new Error("Memory access requires agent_id");
  }
}

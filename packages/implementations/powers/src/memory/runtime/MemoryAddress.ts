/**
 * Memory owner/subject 的稳定逻辑地址编码。
 *
 * 关键点（中文）
 * - 逻辑地址只描述「谁的数据」，与物理根目录、物理文件名无关。
 * - 只有两个 Subject：当前 Agent 私有，与整个 City 共享。
 * - Agent 使用原始 agent_id 段，它本身已经是受限标识符，可直接作为物理目录名。
 * - 写入目标只能解析为当前 AccessContext 中已经存在的 Subject。
 */

import type {
  MemoryAccessContext,
  MemoryOwner,
  MemorySubject,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";

/** Agent 标识允许的字符集合，与本地 Agent 定义保持一致。 */
const AGENT_SEGMENT_PATTERN = /^[a-z0-9_]+$/u;

/** Provider 内部解析后的 owner/subject 地址。 */
export interface MemorySubjectAddress {
  /** 当前记录的持久化所有者。 */
  owner: MemoryOwner;

  /** 当前记录描述的主体。 */
  subject: MemorySubject;

  /** 可直接作为逻辑 memory_id 前缀的地址。 */
  prefix: string;
}

/** 返回当前调用允许读取的 Subject 地址，顺序同时表达默认上下文优先级。 */
export function resolve_readable_memory_addresses(
  access: MemoryAccessContext,
): MemorySubjectAddress[] {
  assert_access_agent(access);
  const addresses: MemorySubjectAddress[] = [create_agent_address(access.agent_id)];
  if (access.city_memory_available) addresses.push(create_city_address());
  return addresses;
}

/**
 * 把有限写入目标解析为真实 owner/subject 地址。
 *
 * 关键点（中文）：`current_workspace` 与 `city` 共用同一个共享 Subject；调用方需要
 * 自行把当前 `workspace_id` 写入记录 metadata，地址层不参与该语义。
 */
export function resolve_writable_memory_address(
  access: MemoryAccessContext,
  target: MemoryWriteTarget,
): MemorySubjectAddress {
  assert_access_agent(access);
  if (target === "agent") return create_agent_address(access.agent_id);
  if (target === "current_workspace") {
    if (!access.workspace_id) {
      throw new Error("Memory target current_workspace requires a Workspace");
    }
    if (!access.city_memory_available) {
      throw new Error("Memory target current_workspace requires City Memory");
    }
    return create_city_address();
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
  const segment = normalize_agent_segment(agent_id);
  return {
    owner: { kind: "agent", agent_id: segment },
    subject: { kind: "agent", agent_id: segment },
    prefix: `agent/${segment}`,
  };
}

/** 创建 City 共享地址。 */
function create_city_address(): MemorySubjectAddress {
  return {
    owner: { kind: "city" },
    subject: { kind: "city" },
    prefix: "city",
  };
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
function assert_access_agent(access: MemoryAccessContext): void {
  if (!String(access.agent_id || "").trim()) {
    throw new Error("Memory access requires agent_id");
  }
}

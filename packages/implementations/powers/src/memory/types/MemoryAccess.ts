/**
 * Memory 所有权、Subject 与访问上下文类型。
 *
 * 关键点（中文）
 * - owner 表示数据由哪个 Store 维护，subject 表示内容描述谁或什么。
 * - 只有两个 Subject：当前 Agent 的私有记忆，与整个 City 的共享记忆。
 * - Workspace 不是 Subject，只作为记录的 metadata 与调用上下文。
 */

/** Memory 数据的持久化所有者。 */
export type MemoryOwner =
  | {
      /** Agent 私有 Store。 */
      kind: "agent";
      /** 拥有当前 Memory 的 Agent 稳定标识。 */
      agent_id: string;
    }
  | {
      /** City 共享 Store。 */
      kind: "city";
    };

/** 一条 Memory 实际描述的主体。 */
export type MemorySubject =
  | {
      /** 当前 Agent 自身。 */
      kind: "agent";
      /** 被描述的 Agent 稳定标识。 */
      agent_id: string;
    }
  | {
      /** 当前 City 的共享事实。 */
      kind: "city";
    };

/** MemorySubject 的类别判别值，用于过滤与分组。 */
export type MemorySubjectKind = MemorySubject["kind"];

/**
 * 模型和调用方可选择的有限写入目标。
 *
 * 关键点（中文）：`current_workspace` 不产生独立 Subject，它与 `city` 共用共享记忆，
 * 只把当前 `workspace_id` 写入记录 metadata。
 */
export type MemoryWriteTarget = "current_workspace" | "agent";

/** MemoryPower 根据可信运行时状态生成的访问上下文。 */
export interface MemoryAccessContext {
  /** 当前 MemoryPower 实例所属 Agent。 */
  agent_id: string;

  /** 当前调用绑定的 Workspace；只作为记录 metadata 与执行上下文，不参与 Subject 隔离。 */
  workspace_id?: string;

  /** 当前调用所属 Session；非 Session 调用时省略。 */
  session_id?: string;

  /** 宿主是否为 MemoryPower 提供了 City 共享 Store。 */
  city_memory_available: boolean;
}

/**
 * Memory 所有权、Subject 与访问上下文类型。
 *
 * 关键点（中文）
 * - owner 表示数据由哪个 Store 维护，subject 表示内容描述谁或什么。
 * - City User、Workspace 与 Shared Memory 共享同一个 City Store，但按 Subject 隔离。
 * - Agent Memory 始终留在当前 Agent 的 Power 私有 Store。
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
      /** City 内当前可信用户。 */
      kind: "user";
      /** Federation 已认证的用户稳定标识。 */
      user_id: string;
    }
  | {
      /** City 内共享的 Workspace。 */
      kind: "workspace";
      /** 当前 Workspace 的稳定标识。 */
      workspace_id: string;
    }
  | {
      /** 当前 City 的公共共享事实。 */
      kind: "city";
    };

/** MemorySubject 的类别判别值，用于过滤与分组。 */
export type MemorySubjectKind = MemorySubject["kind"];

/** 模型和调用方可选择的有限写入目标。 */
export type MemoryWriteTarget = "current_user" | "current_workspace" | "agent";

/** MemoryPower 根据可信运行时状态生成的访问上下文。 */
export interface MemoryAccessContext {
  /** 当前 MemoryPower 实例所属 Agent。 */
  agent_id: string;

  /** 当前调用绑定的 Workspace；未绑定时省略。 */
  workspace_id?: string;

  /** 当前调用所属 Session；非 Session 调用时省略。 */
  session_id?: string;

  /** Federation 已认证的当前用户；不可用或校验失败时省略。 */
  user_id?: string;

  /** 当前用户 Token 绑定的 Bureau/City 空间标识。 */
  city_id?: string;

  /** 宿主是否为 MemoryPower 提供了 City 共享 Store。 */
  city_memory_available: boolean;
}

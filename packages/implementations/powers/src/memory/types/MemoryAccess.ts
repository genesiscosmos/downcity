/**
 * Memory 所有权、Subject 与访问上下文类型。
 *
 * 关键点（中文）
 * - owner 表示数据由哪个 Store 维护，subject 表示内容描述谁或什么。
 * - User 与 Workspace 使用独立共享空间，Agent 保持私有。
 * - City 保留用于显式访问旧记录，自动流程不读取该范围。
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
      /** 用户共享 Store。 */
      kind: "user";
      /** 可信平台用户标识。 */
      user_id: string;
    }
  | {
      /** 项目共享 Store。 */
      kind: "workspace";
      /** 可信项目标识。 */
      workspace_id: string;
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
      /** 当前可信用户。 */
      kind: "user";
      /** 被描述的用户标识。 */
      user_id: string;
    }
  | {
      /** 当前项目。 */
      kind: "workspace";
      /** 被描述的项目标识。 */
      workspace_id: string;
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
 * `current_workspace` 写入当前项目独立空间；user 必须有可信身份。
 */
export type MemoryWriteTarget = "current_workspace" | "user" | "agent";

/** MemoryPower 根据可信运行时状态生成的访问上下文。 */
export interface MemoryAccessContext {
  /** 当前 MemoryPower 实例所属 Agent。 */
  agent_id: string;

  /** 当前调用绑定的 Workspace；只作为记录 metadata 与执行上下文，不参与 Subject 隔离。 */
  workspace_id?: string;

  /** 宿主身份解析器提供的可信用户标识；不可从模型输出解析。 */
  user_id?: string;

  /** 自动流程不读取旧的全局 City 范围。 */
  exclude_city?: boolean;

  /** 当前调用所属 Session；非 Session 调用时省略。 */
  session_id?: string;

  /** 宿主是否为 MemoryPower 提供了 City 共享 Store。 */
  city_memory_available: boolean;
}

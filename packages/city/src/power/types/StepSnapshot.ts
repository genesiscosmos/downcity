/**
 * 一步内冻结的事实快照。
 *
 * 关键点（中文）
 * - 快照每 Step 冻结一次，表达「模型这一步看到了什么」，不是「现在是什么」。
 * - 与活句柄的区别：`PowerContext.workspace.env` 读当前值，本快照读 Step 开始时提交的值。
 * - 不含 `tool_call_id`：一个 Step 可以发起多次调用，调用身份属于 `PowerCall`。
 */

import { session_call_context, read_session_call_context, type SessionDescriptor, type SessionCallContext } from "@downcity/type";

/** 一步内冻结的事实快照。 */
export class StepSnapshot {
  /** 当前 Session 标识；无 Session 调用时为空。 */
  readonly session_id?: string;

  /** 当前 Session 来源。 */
  readonly session_type?: SessionDescriptor["type"];
  /** 当前 Session 的用途。 */
  readonly session_kind?: string;
  /** 当前 Session 的父创建引用。 */
  readonly session_parent?: SessionDescriptor["parent"];
  /** 已有派生深度，完整保留调用事实。 */
  readonly session_delegation_depth?: number;
  /** 父 Session 的固定类型。 */
  readonly session_parent_type?: SessionDescriptor["type"];
  /** 根对话的稳定引用。 */
  readonly session_root_chat_id?: string;
  /** 群组绑定的稳定引用。 */
  readonly session_group_id?: string;
  /** 群组对话的稳定引用。 */
  readonly session_group_session_id?: string;

  /** 当前 Turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Workspace 根目录；无项目会话时为空。 */
  readonly project_root?: string;

  /** 当前 Step 提交的 Workspace 环境快照。 */
  readonly workspace_env: Readonly<Record<string, string>>;

  /** 当前 Step 提交的 Agent 指令快照。 */
  readonly agent_systems: readonly string[];

  constructor(input: Partial<SessionCallContext> & {
    /** 当前 Session 标识。 */
    readonly session_id?: string;
    /** 当前 Turn 标识。 */
    readonly turn_id?: string;
    /** 当前 Workspace 根目录；无项目会话时为空。 */
    readonly project_root?: string;
    /** 当前 Step 提交的 Workspace 环境快照。 */
    readonly workspace_env: Readonly<Record<string, string>>;
    /** 当前 Step 提交的 Agent 指令快照。 */
    readonly agent_systems: readonly string[];
  }) {
    if (input.project_root) this.project_root = input.project_root;
    this.workspace_env = Object.freeze({ ...input.workspace_env });
    this.agent_systems = Object.freeze([...input.agent_systems]);
    if (input.session_id) this.session_id = input.session_id;
    if (input.session_type || input.session_kind) {
      Object.assign(this, session_call_context(read_session_call_context({
        ...input, session_type: input.session_type ?? "work", session_kind: input.session_kind ?? "work",
      })));
    }
    if (input.turn_id) this.turn_id = input.turn_id;
    Object.freeze(this);
  }
}

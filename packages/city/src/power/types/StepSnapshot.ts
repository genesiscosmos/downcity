/**
 * 一步内冻结的事实快照。
 *
 * 关键点（中文）
 * - 快照每 Step 冻结一次，表达「模型这一步看到了什么」，不是「现在是什么」。
 * - 与活句柄的区别：`PowerContext.workspace.env` 读当前值，本快照读 Step 开始时提交的值。
 * - 不含 `call_id`：一个 Step 可以发起多次调用，调用身份属于 `PowerCall`。
 */

import type { PowerJsonValue } from "./Json.js";

/** 当前 Session 来源；与 SessionOrigin 同形。 */
export interface StepSnapshotOrigin {
  /** 来源类型，同时是持久化分区。 */
  readonly type: string;
  /** 来源协议允许携带的其他 JSON 字段。 */
  readonly [key: string]: PowerJsonValue;
}

/** 一步内冻结的事实快照。 */
export class StepSnapshot {
  /** 当前 Session 标识；无 Session 调用时为空。 */
  readonly session_id?: string;

  /** 当前 Session 来源。 */
  readonly session_origin?: StepSnapshotOrigin;

  /** 当前 Turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Workspace 根目录。 */
  readonly project_root: string;

  /** 当前 Step 提交的 Workspace 环境快照。 */
  readonly workspace_env: Readonly<Record<string, string>>;

  /** 当前 Step 提交的 Agent 指令快照。 */
  readonly agent_systems: readonly string[];

  constructor(input: {
    /** 当前 Session 标识。 */
    readonly session_id?: string;
    /** 当前 Session 来源。 */
    readonly session_origin?: StepSnapshotOrigin;
    /** 当前 Turn 标识。 */
    readonly turn_id?: string;
    /** 当前 Workspace 根目录。 */
    readonly project_root: string;
    /** 当前 Step 提交的 Workspace 环境快照。 */
    readonly workspace_env: Readonly<Record<string, string>>;
    /** 当前 Step 提交的 Agent 指令快照。 */
    readonly agent_systems: readonly string[];
  }) {
    this.project_root = input.project_root;
    this.workspace_env = Object.freeze({ ...input.workspace_env });
    this.agent_systems = Object.freeze([...input.agent_systems]);
    if (input.session_id) this.session_id = input.session_id;
    if (input.session_origin) this.session_origin = Object.freeze({ ...input.session_origin });
    if (input.turn_id) this.turn_id = input.turn_id;
    Object.freeze(this);
  }
}

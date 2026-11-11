/**
 * Memory Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 界面只描述「在哪个执行范围上读写了哪条记忆」，不暴露 Provider 内部路径。
 * - 执行范围由两个字段组成：`scope` 决定看哪类记忆，`agent_id` 决定在哪个 Agent 上执行。
 *   两者必须分开，因为 City 共享记忆也要绑定一个真实 Agent 才能调用领域 action。
 * - 所有 mutation 都返回刷新后的列表，避免界面自己拼状态。
 */

import type { MemorySubject } from "@/memory/types/MemoryAccess.js";

/** 界面可切换的记忆范围。 */
export type MemoryMainviewScopeKind = "city" | "agent";

/** 一次枚举返回的一条记忆摘要。 */
export interface MemoryMainviewListItem {
  /** 稳定逻辑记忆标识。 */
  readonly memory_id: string;

  /** 当前记忆的领域分类。 */
  readonly memory_type: string;

  /** 当前记忆实际描述的主体。 */
  readonly subject: MemorySubject;

  /** 列表展示名称。 */
  readonly title: string;

  /** 列表展示的内容片段。 */
  readonly snippet: string;

  /** 当前内容被观察或形成的 ISO 8601 时间。 */
  readonly observed_at: string;

  /** 当前条目是原始证据记录，而不是长期记忆投影。 */
  readonly is_evidence: boolean;

  /** 可选的逻辑引用。 */
  readonly citation?: string;
}

/** 一次枚举返回的完整结果。 */
export interface MemoryMainviewListResult {
  /** 应用过滤条件后的分页条目。 */
  readonly items: MemoryMainviewListItem[];

  /** 应用过滤条件后的条目总数。 */
  readonly total: number;
}

/** 一次读取的执行范围。 */
export interface MemoryMainviewScopeInput {
  /** 要查看的记忆范围类别。 */
  readonly scope: MemoryMainviewScopeKind;

  /** 执行领域 action 的 Agent 稳定标识；两种范围都必须提供一个真实 Agent。 */
  readonly agent_id: string;

  /** 提供 Workspace 上下文的 Workspace ID。 */
  readonly workspace_id: string;
}

/** 枚举记忆的输入。 */
export interface MemoryMainviewListInput extends MemoryMainviewScopeInput {
  /** 只返回这些 Subject 类别的记忆。 */
  readonly subject_kinds?: string[];

  /** 最多返回的条目数量。 */
  readonly limit?: number;

  /** 跳过的条目数量，用于分页。 */
  readonly offset?: number;
}

/** 读取一条记忆详情的输入。 */
export interface MemoryMainviewReadInput extends MemoryMainviewScopeInput {
  /** 目标稳定记忆标识。 */
  readonly memory_id: string;
}

/** 读取一条记忆详情的结果。 */
export interface MemoryMainviewReadResult {
  /** 是否成功定位到该记忆。 */
  readonly found: boolean;

  /** 目标稳定记忆标识。 */
  readonly memory_id: string;

  /** 成功时的完整 Markdown 正文。 */
  readonly content?: string;

  /** 成功时的领域分类。 */
  readonly memory_type?: string;

  /** 成功时的展示名称。 */
  readonly title?: string;

  /** 成功时描述的主体。 */
  readonly subject?: MemorySubject;

  /** 成功时的观察时间。 */
  readonly observed_at?: string;

  /** 成功时的逻辑引用。 */
  readonly citation?: string;

  /** 成功时的证据来源标识。 */
  readonly source_ids?: string[];

  /** 失败时的用户可见原因。 */
  readonly error?: string;
}

/** 写入一条记忆的输入。 */
export interface MemoryMainviewRememberInput extends MemoryMainviewScopeInput {
  /** 需要长期保留的原始内容。 */
  readonly content: string;

  /** 有限语义写入目标。 */
  readonly target: string;

  /** 可选的人类可读主题。 */
  readonly topic?: string;

  /** 可选目标记忆分类。 */
  readonly memory_type?: string;
}

/** 修订一条记忆的输入。 */
export interface MemoryMainviewReviseInput extends MemoryMainviewScopeInput {
  /** 需要修订的稳定记忆标识。 */
  readonly memory_id: string;

  /** 描述目标变更的明确修订指令。 */
  readonly instruction: string;
}

/** 删除一条记忆的输入。 */
export interface MemoryMainviewForgetInput extends MemoryMainviewScopeInput {
  /** 需要删除或失效的稳定记忆标识。 */
  readonly memory_id: string;
}

/** 一次写入后的结果，同时给出刷新后的列表。 */
export interface MemoryMainviewMutationResult extends MemoryMainviewListResult {
  /** 本次写操作是否成功完成。 */
  readonly operation_success: boolean;

  /** 成功时的用户可见摘要。 */
  readonly message?: string;

  /** 写操作实际影响的稳定记忆标识。 */
  readonly memory_id?: string;

  /** 失败时的用户可见原因。 */
  readonly error?: string;
}

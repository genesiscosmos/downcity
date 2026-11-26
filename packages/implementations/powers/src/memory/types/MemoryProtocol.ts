/** Provider 与应用服务的统一记录查询协议；所有写入共用 scope 事务端口。 */
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { ModelReference } from "@downcity/type";
import type { MemoryAccessContext, MemoryKnowledgeAccess } from "./MemoryAccess.js";
import type { MemoryCommitProvider } from "./MemoryTransaction.js";
import type { MemoryKind, MemoryRecord, MemoryScopeType, MemorySourceSelector } from "./MemoryRecord.js";
export type { MemoryRecord, MemoryRememberInput, MemoryUpdateInput, MemoryForgetInput, MemoryWriteResult, MemorySource, MemorySourceSelector, MemoryScope, MemoryScopeType, MemoryKind, MemoryState } from "./MemoryRecord.js";

/** Provider 健康状态，与对象和执行状态无关。 */
export type MemoryProviderState = "ready" | "degraded";
/** 后端明确声明的能力。 */
export interface MemoryProviderCapabilities {
  /** 支持统一事务写入。 */
  remember: boolean;
  /** 支持检索。 */
  recall: boolean;
  /** 支持精确读取。 */
  read: boolean;
  /** 支持按范围枚举。 */
  list: boolean;
  /** 支持退出有效集合。 */
  forget: boolean;
  /** 提供跨进程锁、版本校验、原子发布和持久回执。 */
  transactions: boolean;
}
/** Provider 状态结果，不在 inspect 时扫描私有记忆。 */
export interface MemoryStatusResult {
  /** 后端稳定名称。 */
  provider: string;
  /** 生命周期状态。 */
  state: MemoryProviderState;
  /** 可用能力。 */
  capabilities: MemoryProviderCapabilities;
  /** 宿主生成的诊断统计。 */
  details?: PowerJsonObject;
  /** 可观察诊断，不掩盖数据错误。 */
  warnings?: string[];
}
/** 公共范围过滤，不接受任意身份。 */
export interface MemoryFilter {
  /** 省略时读取当前获准范围。 */
  scope?: MemoryScopeType;
  /** 省略时读取两种内容。 */
  kind?: MemoryKind;
}
/** 检索输入，先授权过滤再打分。 */
export interface MemoryRecallInput extends MemoryFilter {
  /** 真实宿主权限。 */
  access: MemoryKnowledgeAccess;
  /** 非空自然语言查询。 */
  query: string;
  /** 最大结果数。 */
  max_results?: number;
  /** 最小相关分数。 */
  min_score?: number;
}
/** 固定版本的查询命中。 */
export interface MemoryRecallItem {
  /** 完整记录及版本。 */
  memory: MemoryRecord;
  /** 归一化分数。 */
  score: number;
  /** 有界正文片段。 */
  snippet: string;
  /** 命中的内容字段，不将标题拼入正文。 */
  matched_field: "title" | "content";
  /** 原始正文 1-based 起始行。 */
  start_line: number;
  /** 原始正文 1-based 结束行。 */
  end_line: number;
  /** 包含版本及正文行号的逻辑引用。 */
  citation: string;
}
/** 检索结果。 */
export interface MemoryRecallResult {
  /** 后端名称。 */
  provider: string;
  /** 授权过滤后的有序命中。 */
  items: MemoryRecallItem[];
  /** 可观察诊断。 */
  warnings?: string[];
}
/** 精确读取输入；范围只相对 content。 */
export interface MemoryReadInput {
  /** 宿主权限。 */
  access: MemoryKnowledgeAccess;
  /** 稳定对象身份。 */
  memory_id: string;
  /** 1-based 正文起点。 */
  from_line?: number;
  /** 最大正文行数。 */
  line_count?: number;
}
/** 普通读取不返回墓碑正文。 */
export interface MemoryReadResult {
  /** 请求身份。 */
  memory_id: string;
  /** 当前有效对象；不存在或退出时为空。 */
  memory: MemoryRecord | null;
  /** 请求部分正文时的实际行号边界，避免把片段当完整正文。 */
  range?: { /** 1-based 起点。 */ start_line: number; /** 1-based 终点，空区间为起点前一行。 */ end_line: number; /** 完整正文行数。 */ total_lines: number };
}
/** 授权范围内分页输入。 */
export interface MemoryListInput extends MemoryFilter {
  /** 宿主权限。 */
  access: MemoryKnowledgeAccess;
  /** 最大返回条数。 */
  limit?: number;
  /** 分页偏移。 */
  offset?: number;
}
/** 列表使用真实对象及唯一展示 label。 */
export type MemoryListItem = MemoryRecord & {
  /** Agreement 摘要或 Knowledge 真实标题。 */
  label: string;
};
/** 分页结果。 */
export interface MemoryListResult {
  /** 后端名称。 */
  provider: string;
  /** 当前页。 */
  items: MemoryListItem[];
  /** 授权及过滤后的总数。 */
  total: number;
  /** 各授权范围总量。 */
  scope_counts: Record<MemoryScopeType, number>;
}
/** Session 提炼的固定输入。 */
export interface MemoryDigestInput {
  /** 显式选择的 canonical Session。 */
  session_id: string;
  /** 受支持的 Session 类型。 */
  type: "chat" | "work";
  /** 唯一写入范围。 */
  scope: MemoryScopeType;
  /** 唯一提炼种类。 */
  kind: MemoryKind;
  /** 有界消息窗口。 */
  max_messages?: number;
}
/** 异步修订绑定对象和版本。 */
export interface MemoryReviseInput {
  /** 已读对象。 */
  memory_id: string;
  /** 已读版本。 */
  expected_version: string;
  /** 可信执行上下文。 */
  access: MemoryAccessContext;
  /** 语义修订要求。 */
  instruction: string;
  /** 请求材料，不自动成为用户证据。 */
  evidence?: string;
  /** 已授权原始消息选择。 */
  source_refs?: MemorySourceSelector[];
}
/** Provider 不调用模型，写入必须通过统一事务。 */
export interface MemoryProvider {
  /** 稳定名称。 */
  readonly name: string;
  /** 声明能力。 */
  readonly capabilities: MemoryProviderCapabilities;
  /** 缺少强事务时显式禁止写入及 Job。 */
  readonly transactions?: MemoryCommitProvider;
  /** 初始化独占存储。 */
  initialize(): Promise<void>;
  /** 不读取任何 scope 的健康检查。 */
  inspect(): Promise<MemoryStatusResult>;
  /** 授权范围统计。 */
  status(access: MemoryKnowledgeAccess): Promise<MemoryStatusResult>;
  /** 所需 scope 必须都有已迁移或明确为空标记。 */
  assert_ready(access: MemoryKnowledgeAccess): Promise<void>;
  /** 检索 title 和 content。 */
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>;
  /** 精确读取当前有效版本。 */
  read(input: MemoryReadInput): Promise<MemoryReadResult>;
  /** 范围分页。 */
  list(input: MemoryListInput): Promise<MemoryListResult>;
  /** 释放资源。 */
  dispose(): Promise<void>;
}
/** Memory 实例的宿主配置，不暴露运行存储路径给模型。 */
export interface MemoryPowerOptions {
  /** 统一记录提交后的业务回调。 */
  readonly on_changed?: import("./MemoryChange.js").MemoryChangeHandler;
  /** 后台知识整理配置；默认关闭。 */
  dreaming?: import("./MemoryDream.js").MemoryDreamOptions;
  /** 已登记的专用执行 Agent；省略时使用请求所属 Agent，模型由该 Agent 定义持有。 */
  execution_agent_id?: string;
  /** 仅用于新 Job 的可信模型解析器。 */
  resolve_model_binding?: import("./MemoryModelBinding.js").MemoryModelResolver;
  /** 宿主注入的统一记录后端。 */
  provider?: MemoryProvider;
  /** City 分配的私有共享 Storage。 */
  shared_root_path?: string;
  /** 平台数据根，只由宿主提供。 */
  platform_root_path?: string;
}
/** Action 的公开 JSON 参数。 */
export type MemoryActionPayload = Record<string, PowerJsonValue>;

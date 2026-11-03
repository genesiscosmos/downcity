/**
 * Agent 交互集合的公开契约。
 *
 * Agent 绑定主体身份，引用只定位原 Session 与 Turn；状态始终来自 canonical Interaction。
 * 私密输入仅允许受信宿主经 submit_private 提交，普通 respond 不接受私密答案。
 */
import type {
  SessionAgentInteraction,
  SessionInteractionResponse,
  SessionInteractionResult,
} from "@downcity/type";
import type { AgentSessions } from "@/agent/AgentSessions.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** 当前 Agent 内唯一的原交互引用；不得省略分类或 Turn 身份。 */
export interface AgentInteractionReference {
  /** 原 Session 的来源分类，区分同名 Chat、Work 与其他分类。 */
  session_category: string;
  /** 原 Session 的稳定标识。 */
  session_id: string;
  /** 原交互所属 Turn，响应时在原 Session 串行链内验证。 */
  turn_id: string;
  /** 原 Session canonical Interaction 的稳定标识。 */
  interaction_id: string;
}

/** 原 Session Interaction 的只读快照，不另行持久化处理状态。 */
export interface AgentInteraction {
  /** 当前 Agent 内定位原请求的完整引用。 */
  reference: AgentInteractionReference;
  /** 原 Session 保存的 canonical Interaction 快照，包含请求与当前状态。 */
  interaction: SessionAgentInteraction;
  /** 原 Session 当前仍持有此 Turn 的运行 waiter 时为 true；历史悬空请求为 false。 */
  can_respond: boolean;
}

/** 集合查询；默认返回全部活动 Session 的待处理交互。 */
export interface AgentListInteractionsInput {
  /** 最多返回的交互数量；省略时返回全部，按请求创建时间升序排列。 */
  limit?: number;
}

/** 用户对原交互的响应；不允许通过引用更换主体。 */
export interface AgentRespondInteractionInput {
  /** 必须完整匹配原 Session、Turn 和 Interaction 的公开引用。 */
  reference: AgentInteractionReference;
  /** 复用 Session 的响应信封及校验规则。 */
  response: SessionInteractionResponse;
}

/** 从原 Session mutation 投影的实时变化；订阅不补发历史快照。 */
export type AgentInteractionChange = {
  /** canonical Interaction 已提交；快照可能是 pending、resolved 或 cancelled。 */
  type: "updated";
  /** 已提交的原交互快照及完整引用。 */
  item: AgentInteraction;
} | {
  /** 原 Session 已移出活动集合或历史被清空，调用方移除其全部交互投影。 */
  type: "removed";
  /** 被移出或清空的 Session 分类。 */
  session_category: string;
  /** 被移出或清空的 Session 标识。 */
  session_id: string;
};

/** Agent 主体持有的交互集合；读取不恢复 Session 执行器。 */
export interface AgentInteractionCollection {
  /** 查询所有来源的活动待处理交互；先订阅再查询可覆盖查询期间的变化。 */
  list(input?: AgentListInteractionsInput): Promise<AgentInteraction[]>;
  /** 订阅未来变化；监听从 Agent 创建时就建立，与 UI 是否打开无关。 */
  subscribe(listener: (change: AgentInteractionChange) => void): () => void;
  /** 回到已加载的原 Session 串行校验并提交响应，不创建或恢复执行器。 */
  respond(input: AgentRespondInteractionInput): Promise<SessionInteractionResult>;
  /** 受信宿主专用私密问答入口；明文只进入原 Session 的私密内存。 */
  submit_private(input: AgentRespondInteractionInput): Promise<SessionInteractionResult>;
}

/** 交互集合实现的内部依赖，不作为 SDK 入口导出。 */
export interface AgentInteractionsOptions {
  /** 当前 Agent 唯一的 Session 集合；响应只访问已缓存对象。 */
  sessions: AgentSessions;
  /** 延迟取得 Agent 绑定后的存储，不提前创建独立存储。 */
  get_store: () => SessionStore;
  /** 记录订阅者异常，避免破坏原 Session 状态提交。 */
  logger: Logger;
}

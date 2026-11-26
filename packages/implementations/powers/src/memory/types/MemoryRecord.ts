/** Memory 的唯一内容与来源契约。宿主绑定归属及证据，模型只提交内容和来源选择。 */

/** 调用方可选择的范围；真实身份只由宿主解析。 */
export type MemoryScopeType = "user" | "agent" | "workspace";
/** 记录用途，持续约定与按需知识具有不同内容格式。 */
export type MemoryKind = "agreement" | "knowledge";
/** 有效性与真实性、执行状态无关。 */
export type MemoryState = "active" | "invalidated" | "deleted";

/** 已解析的数据归属，不是调用方可填写的身份。 */
export interface MemoryScope {
  /** 归属的有限类别。 */
  type: MemoryScopeType;
  /** 当前本地用户、执行 Agent 或绑定 Workspace 的真实稳定身份。 */
  id: string;
}

/** 普通调用只选择同 Session 已获准读取的 canonical 文本。 */
export interface MemorySourceSelector {
  /** 当前 Session 中的原始消息身份。 */
  message_id: string;
  /** 消息包含多个 Part 或引用工具结果时必须指定的文本 Part。 */
  part_id?: string;
  /** 必须连续匹配获准读取原文的摘录；省略时宿主有界捕获。 */
  excerpt?: string;
}

/** 来源定位按来源类型约束，不能扩展任意 metadata。 */
export type MemorySourceLocator =
  | {
      /** 真实工具调用的身份。 */
      tool_call_id?: string;
      /** 真实宿主管理操作的身份。 */
      operation_id?: string;
      /** 请求所属执行 Agent。 */
      agent_id?: string;
      /** 请求所属 canonical Session 类型。 */
      session_type?: string;
      /** 请求所属 canonical Session 身份。 */
      session_id?: string;
    }
  | {
      /** canonical 消息所属 Agent。 */
      agent_id: string;
      /** canonical Session 的真实类型。 */
      session_type: string;
      /** canonical Session 的真实身份。 */
      session_id: string;
      /** 被实际读取的消息身份。 */
      message_id: string;
      /** 被实际读取的原始文本 Part 身份。 */
      part_id: string;
      /** 实际被捕获的 canonical 文本字段；结构化折叠包不冒充完整工具输出。 */
      field?: "text" | "model_output";
      /** 原始 Part 文本 UTF-16 半开区间起点。 */
      start_offset: number;
      /** 原始 Part 文本 UTF-16 半开区间终点。 */
      end_offset: number;
    }
  | {
      /** 可信 TaskFact 的稳定事件身份。 */
      event_id: string;
      /** 原始任务身份。 */
      task_id: string;
      /** 原始待处理项身份。 */
      item_id: string;
      /** 有执行产物时的原始时间，不冒充执行身份。 */
      run_timestamp?: string;
      /** 已捕获产物的原始指纹。 */
      output_fingerprint?: string;
      /** 捕获文本在产物中的 UTF-16 半开区间。 */
      output_range?: { /** 起点。 */ start: number; /** 终点。 */ end: number };
      /** 是否仅捕获部分产物。 */
      truncated?: boolean;
    }
  | {
      /** 人工迁移选择固化的历史材料身份。 */
      snapshot_id: string;
    };

/** 系统固化的有界来源；存在来源不表示结论已经验证。 */
export interface MemorySource {
  /** 宿主生成并绑定实际捕获内容的来源身份。 */
  source_id: string;
  /** 真实来源性质，模型不能自行填写。 */
  source_type: "request" | "management_input" | "session_message" | "task_fact" | "legacy_snapshot";
  /** 原始角色；请求必须保持 request，未知历史保持 unknown。 */
  role: "request" | "user" | "agent" | "tool" | "unknown";
  /** 实际捕获文本的 SHA-256，不声称覆盖完整 Session。 */
  content_hash: string;
  /** 宿主捕获时间，不冒充原事件时间。 */
  captured_at: string;
  /** 原始来源的类型化定位，有 canonical 来源时必须提供。 */
  locator?: MemorySourceLocator;
  /** 获准保留的实际原句。 */
  excerpt?: string;
  /** 宿主记录的来源缺失或捕获边界。 */
  note?: string;
}

/** 用户提交内容；判别联合禁止 Agreement 标题。 */
export type MemoryContent =
  | {
      /** 一条可独立维护的持续约定。 */
      kind: "agreement";
      /** 完整规则及其适用条件。 */
      content: string;
      /** Agreement 不保存独立标题。 */
      title?: never;
    }
  | {
      /** 有未来用途的按需知识。 */
      kind: "knowledge";
      /** 非空真实标题；不作为唯一键。 */
      title: string;
      /** 完整 Markdown 正文，引用行号只相对此字段计算。 */
      content: string;
    };

/** 系统管理的记录字段，普通写入不得覆盖。 */
export interface MemoryRecordIdentity {
  /** 系统生成的逻辑身份，不授予路径访问。 */
  memory_id: string;
  /** 宿主绑定的真实归属。 */
  scope: MemoryScope;
  /** 不透明并发令牌。 */
  version: string;
  /** 当前有效性，不表示事实可信程度。 */
  state: MemoryState;
  /** 本版依据及真实请求来源，至少一项。 */
  sources: MemorySource[];
  /** 初次创建的宿主 UTC ISO 时间。 */
  created_at: string;
  /** 当前版本发布的宿主 UTC ISO 时间。 */
  updated_at: string;
}

/** 所有入口使用同一种完整领域对象。 */
export type MemoryRecord = MemoryRecordIdentity & MemoryContent;

/** 新建对象的唯一公开输入。 */
export type MemoryRememberInput = MemoryContent & {
  /** 有限范围选择器，由宿主绑定真实身份。 */
  scope: MemoryScopeType;
  /** 可选的同 Session canonical 文本选择。 */
  source_refs?: MemorySourceSelector[];
  /** 重试时复用的业务幂等键。 */
  request_id?: string;
};

/** 更新完整内容，类型及归属从已读对象继承。 */
export interface MemoryUpdateInput {
  /** 已读对象的稳定身份。 */
  memory_id: string;
  /** 必须与已读版本一致的并发令牌。 */
  expected_version: string;
  /** 完整替换正文，不接受编辑指令。 */
  content: string;
  /** Knowledge 必填，Agreement 禁止，由已读类型进一步校验。 */
  title?: string;
  /** 本版使用的原始消息选择。 */
  source_refs?: MemorySourceSelector[];
  /** 重试复用的业务幂等键。 */
  request_id?: string;
}

/** 退出普通召回和 Profile，保留审计墓碑。 */
export interface MemoryForgetInput {
  /** 要退出的稳定对象身份。 */
  memory_id: string;
  /** 已读版本，失配不自动重试。 */
  expected_version: string;
  /** 默认 deleted；invalidated 表示撤销或不再适用。 */
  state?: "invalidated" | "deleted";
  /** 操作的原始来源选择。 */
  source_refs?: MemorySourceSelector[];
  /** 重试复用的业务幂等键。 */
  request_id?: string;
}

/** 同步操作回执与记录有效性分开。 */
export interface MemoryWriteResult {
  /** 只有 committed 表示本次发布了新版本。 */
  status: "committed" | "unchanged";
  /** 请求的确定性操作。 */
  operation: "create" | "update" | "delete" | "invalidate";
  /** 已持久化幂等键。 */
  request_id: string;
  /** 与数据同次发布的提交身份。 */
  commit_id: string;
  /** 宿主提交时间。 */
  committed_at: string;
  /** 有效记录完整返回，退出记录仅回显身份和状态。 */
  record: MemoryRecord | Pick<MemoryRecord, "memory_id" | "scope" | "version" | "state">;
  /** 派生的上下文生效提示，不存入记录。 */
  activation: "next_turn_or_new_session" | "on_recall";
}

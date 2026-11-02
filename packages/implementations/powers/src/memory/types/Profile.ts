/** User 与 Agent Core Memory 的统一文档定位协议；Workspace 不提供常驻 Profile。 */
export type ProfileScope =
  | { /** 平台唯一使用者，跨 Agent 生效。 */ target: "user" }
  | {
      /** 当前 Agent 专属约定。 */
      target: "agent";
      /** 宿主登记的稳定 Agent 标识。 */
      agent_id: string;
    };

/** 由宿主或 Coordinator 传入的来源；授权与原始消息可访问性由调用方核验。 */
export interface ProfileMutationSource {
  /** 稳定请求标识；同一请求重试沿用，不能用于不同正文。 */
  source_key: string;
  /** 已获准使用的稳定来源定位；不接受空数组或空定位。 */
  source_refs: string[];
}

/** 一次读取的完整正文及并发版本，供 Coordinator 在锁外制定编辑。 */
export interface ProfileDocument {
  /** 原始 Markdown 正文，包含用于重放保护的来源标记。 */
  content: string;
  /** 原始正文的 SHA-256；不存在时为零长度正文的哈希。 */
  version: string;
}

/** 确定性文件变更的结果；统一发布与 Job 回执由 Coordinator 负责。 */
export interface ProfileMutationResult {
  /** 文件操作实际结果；重复追加返回 unchanged。 */
  status: "saved" | "updated" | "deleted" | "unchanged";
  /** 操作完成后实际正文的 SHA-256。 */
  version: string;
  /** 来源请求标识的 SHA-256，避免对外返回原始定位。 */
  source_hash: string;
}

/** Profile 优化候选；仅供 Coordinator 决定是否创建 Memory Job。 */
export interface ProfileOptimizationCandidate extends ProfileDocument {
  /** 候选正文所属的已授权范围。 */
  scope: ProfileScope;
  /** 去掉内部来源标记后的 Unicode 字符数。 */
  characters: number;
}

/** 一轮核心更正的结果；仅表示当前读取状态，不更新持久 system 快照。 */
export interface ProfileContextUpdates {
  /** 本轮需要注入的低权限参考块，合计不超过调用方给定的字符预算。 */
  blocks: import("@downcity/type").SessionHookContextBlock[];
  /** 本轮读取到的最新版本，仅用于诊断；临时注入后不可用它推进冻结 system 基线。 */
  snapshots: ProfileContextSnapshot[];
  /** 是否有正文因预算被截断；被省略部分不能继续沿用旧快照。 */
  truncated: boolean;
}

/** 一轮核心更正输入；基线由 Session 的持久 system 快照提供。 */
export interface ProfileContextSnapshot {
  /** 该份快照对应的 User 或 Agent 范围。 */
  scope: ProfileScope;
  /** 冻结快照的正文版本；恢复时未知则省略并明确校验当前投影。 */
  version?: string;
}

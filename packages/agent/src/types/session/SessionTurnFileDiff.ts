/**
 * Session Turn 文件改动的 canonical 数据类型。
 *
 * 这些类型描述一个 Turn 开始与结束快照之间的文件差异。数据作为 Assistant data part
 * 持久化，因此历史恢复、远程传输和不同宿主都共享同一事实源。
 */

/** 单个文件在当前 Turn 内的最终变化类型。 */
export type SessionTurnFileDiffStatus = "added" | "deleted" | "modified";

/** 当前 Turn 对单个 Workspace 文件产生的完整差异。 */
export interface SessionTurnFileDiff {
  /** 相对于 Git 工作树根目录的文件路径，统一使用正斜杠。 */
  file: string;
  /** 文件在 Turn 首尾快照之间的变化类型。 */
  status: SessionTurnFileDiffStatus;
  /** 当前 Turn 为该文件新增的文本行数；二进制文件固定为 0。 */
  additions: number;
  /** 当前 Turn 从该文件删除的文本行数；二进制文件固定为 0。 */
  deletions: number;
  /** Git unified diff；二进制文件可能只包含二进制变化说明。 */
  patch: string;
}

/** 持久化到 Assistant data part 的当前 Turn 文件改动汇总。 */
export interface SessionTurnFileDiffData {
  /** 当前 Turn 发生变化的文件，按路径稳定排序。 */
  files: SessionTurnFileDiff[];
  /** 全部变化文件的新增行数总和。 */
  additions: number;
  /** 全部变化文件的删除行数总和。 */
  deletions: number;
}

/** Session Turn 生命周期依赖的 Workspace 快照能力。 */
export interface SessionWorkspaceSnapshot {
  /** 捕获当前 Workspace 状态并返回 shadow Git tree 标识；不可用时返回 undefined。 */
  capture(): Promise<string | undefined>;
  /** 比较两个 shadow Git tree，返回逐文件差异。 */
  diff(from_snapshot: string, to_snapshot: string): Promise<SessionTurnFileDiff[]>;
}

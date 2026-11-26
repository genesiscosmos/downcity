/** GroupSession 持久化协议：只描述 GroupSession 所需的底层数据能力。 */

import type { GroupMessage } from "@/types/group/Group.js";
import type { GroupDispatchTurnRecord } from "@/types/group/GroupDispatch.js";
import type { GroupSessionArchiveResult, GroupSessionCleanArchiveResult } from "@/types/group/GroupSession.js";
import type { FileSystem } from "@downcity/type";

/** GroupSession 的持久化元数据。 */
export interface GroupSessionHistoryMeta {
  /** metadata schema 版本。 */
  readonly v: 2;
  /** 当前 GroupSession 标识。 */
  readonly session_id: string;
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 当前 GroupSession 绑定的 Workspace 标识；未绑定时为空。 */
  readonly workspace_id?: string;
  /** 当前 GroupSession 持久化的用户可见标题。 */
  readonly title?: string;
  /** 首次创建时间戳。 */
  readonly created_at: number;
  /** 最近更新时间戳。 */
  readonly updated_at: number;
  /** 已持久化消息数量。 */
  readonly message_count: number;
  /** 最后一条消息的用户可见预览。 */
  readonly preview_text?: string;
  /** GroupSession 为每个成员 Agent 复用的 AgentSession 标识。 */
  readonly member_session_ids?: Readonly<Record<string, string>>;
  /** 尚未消费的用户消息和整轮回复 ID；执行中的输入保留到整轮交接，重启从同一集合恢复。 */
  readonly pending_message_ids?: readonly string[];
  /** pending_message_ids 的用户消息子集：消息到达时无成员执行或等待交互，消费前保留至少一位回应的兜底资格。 */
  readonly idle_response_message_ids?: readonly string[];
}

/** 单个 GroupSession 的持久化数据视图。 */
export interface GroupSessionDataStore {
  /** 当前 GroupSession 标识。 */
  readonly session_id: string;
  /** 初始化当前 GroupSession 的存储布局。 */
  initialize(): Promise<void>;
  /** 读取完整共享消息历史。 */
  list_messages(): Promise<GroupMessage[]>;
  /** 追加一条消息并同步更新 metadata。 */
  append_message(message: GroupMessage): Promise<void>;
  /** 读取当前 GroupSession metadata。 */
  read_metadata(): Promise<GroupSessionHistoryMeta>;
  /** 写入当前 GroupSession metadata。 */
  write_metadata(metadata: GroupSessionHistoryMeta): Promise<void>;
  /** 在文件锁内合并更新当前 GroupSession metadata。 */
  update_metadata(patch: Partial<GroupSessionHistoryMeta>): Promise<GroupSessionHistoryMeta>;
  /** 读取当前 GroupSession 中每个 dispatch_id 的最新调度 Turn 快照。 */
  list_dispatch_turns(): Promise<GroupDispatchTurnRecord[]>;
  /** 向当前 GroupSession 的调度审计日志追加一个 Turn 状态快照。 */
  append_dispatch_turn(turn: GroupDispatchTurnRecord): Promise<void>;
}

/** 精确查询来源的只读结果，生命周期状态不在消费方持久化。 */
export interface GroupSessionMetadataResult {
  /** 原群聊当前的小字段快照，不加载消息。 */
  metadata: GroupSessionHistoryMeta;
  /** 原群聊是否位于归档区。 */
  archived: boolean;
}

/** Group 所拥有的全部 GroupSession 持久化入口。 */
export interface GroupSessionStore {
  /** 精确读取一个活动或归档会话；不存在返回 null，不创建目录。 */
  read_session_metadata(session_id: string): Promise<GroupSessionMetadataResult | null>;
  /** 返回指定 GroupSession 的持久化视图。 */
  session(session_id: string): GroupSessionDataStore;
  /** 判断指定 GroupSession 是否存在（活动区）。 */
  has_session(session_id: string): Promise<boolean>;
  /** 列出当前 Group 活动区的 Session metadata（不含已归档）。 */
  list_session_metadata(): Promise<GroupSessionHistoryMeta[]>;
  /** 删除指定 GroupSession 的全部数据（活动区）。 */
  remove_session(session_id: string): Promise<boolean>;
  /**
   * 把一个活动 GroupSession 迁入归档区。
   *
   * GroupSession 按当前 Group 内的 session_id 定位，归档不改变标识。
   * 存储实现负责将活动记录迁入独立归档区。
   *
   * 不变量（两个方向都不允许静默成功）：
   *
   * - 源不存在 → 报错；
   * - 目标已存在 → 报错（覆盖会丢掉一份真实数据）。
   */
  archive_session(session_id: string): Promise<GroupSessionArchiveResult>;
  /** 列出归档区的 Session metadata。 */
  list_archived_session_metadata(): Promise<GroupSessionHistoryMeta[]>;
  /** 删除归档区中的指定 Session。 */
  remove_archived_session(session_id: string): Promise<boolean>;
  /** 永久清空归档区。 */
  clean_archive(): Promise<GroupSessionCleanArchiveResult>;
  /**
   * 永久删除当前 Group 的**全部** GroupSession 数据（活动区 + 归档区）。
   *
   * 与 `clean_archive` 的区别：那个只动归档区，这个连活动区一起删。
   * 它服务于「Group 被删除」——Group 是群聊的**所有者**，所有者消失时它拥有的数据不该继续存在。
   * 没有它时删掉一个 Group 会在磁盘上留下无人认领的孤儿目录。
   */
  purge(): Promise<void>;
  /** 释放当前 Store 持有的资源。 */
  dispose(): Promise<void>;
}

/** 创建基于 City StorageScope 的 GroupSession Store。 */
export interface GroupSessionStoreOptions {
  /** City StorageScope 提供的受控文件能力。 */
  readonly files: FileSystem;
  /** 当前 Group 的存储作用域根目录。 */
  readonly storage_root_path: string;
  /** 当前 Group 稳定标识。 */
  readonly group_id: string;
}

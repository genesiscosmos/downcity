/** GroupSession 持久化协议：只描述 GroupSession 所需的底层数据能力。 */

import type { GroupMessage } from "@/types/group/Group.js";
import type { FileSystem } from "@downcity/workspace";

/** GroupSession 的持久化元数据。 */
export interface GroupSessionHistoryMeta {
  /** metadata schema 版本。 */
  readonly v: 1;
  /** 当前 GroupSession 标识。 */
  readonly session_id: string;
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 当前 GroupSession 绑定的 Workspace 标识；未绑定时为空。 */
  readonly workspace_id?: string;
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
}

/** Group 所拥有的全部 GroupSession 持久化入口。 */
export interface GroupSessionStore {
  /** 返回指定 GroupSession 的持久化视图。 */
  session(session_id: string): GroupSessionDataStore;
  /** 判断指定 GroupSession 是否存在。 */
  has_session(session_id: string): Promise<boolean>;
  /** 列出当前 Group 的持久化 Session metadata。 */
  list_session_metadata(): Promise<GroupSessionHistoryMeta[]>;
  /** 删除指定 GroupSession 的全部数据。 */
  remove_session(session_id: string): Promise<boolean>;
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

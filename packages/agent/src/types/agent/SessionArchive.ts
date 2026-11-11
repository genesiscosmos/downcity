/**
 * Session 子树归档所需的内部端口。
 *
 * 集合拥有缓存与生命周期预留，归档流程只负责生成计划、关闭节点输入和搬迁存储。
 * 移除事件先记录，在集合释放归档保护后由拥有者通知宿主。
 */
import type { AgentArchiveSessionInput } from "./SessionTypes.js";
import type { SessionRemovalEvent } from "./SessionRemoval.js";
import type { AgentManagedSession } from "../session/SessionOptions.js";
import type { SessionStore } from "../store/SessionStore.js";

export type SessionArchiveOptions = {
  /** 当前 Agent 的稳定标识，用于限定可归档的后代关系。 */
  agent_id: string;
  /** 当前 Agent 的唯一 Session 存储，负责活动和归档数据的查询与搬迁。 */
  store: SessionStore;
  /** 同步读取已有实例，不恢复实例，也不打开数据库。 */
  get_cached: (session_id: string, category: string) => AgentManagedSession | undefined;
  /** 成功搬迁后释放集合缓存及其观察订阅。 */
  remove_cached: (session_id: string, category: string) => void;
  /** 原子预留完整计划并结束关系扫描保护；失败时尚未搬迁任何节点。 */
  reserve_sessions: (plan: AgentArchiveSessionInput[]) => void;
  /** 记录已提交的移除事实；宿主通知在归档生命周期保护外进行。 */
  record_removal: (event: SessionRemovalEvent) => void;
};

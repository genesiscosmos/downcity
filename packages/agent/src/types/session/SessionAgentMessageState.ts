/**
 * Assistant Message 状态转换器的依赖类型。
 *
 * 该类型只暴露 canonical Message 所有者允许使用的最小能力，避免内部协作者
 * 复制 SessionMessages 的消息索引或 Mutation 发布状态。
 */

import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionMessage } from "@downcity/type";
import type { SessionMutation } from "@downcity/type";

/** Assistant Message 状态转换器的构造参数。 */
export interface SessionAgentMessageStateOptions {
  /** 当前 Assistant Message 所属 Session 的稳定标识。 */
  session_id: string;
  /** 负责持久化 canonical Message 稳定检查点的 Store。 */
  store: SessionStorage;
  /** 读取 SessionMessages 当前持有的 canonical Message 集合。 */
  list_messages: () => Iterable<SessionMessage>;
  /** 接受已持久化的完整 Message 快照，并按需发布 Mutation。 */
  accept_message: (
    message: SessionMessage,
    publish_mutation?: boolean,
  ) => void;
  /** 接受未持久化的实时 Mutation，并只更新当前运行投影。 */
  project_mutation: (
    mutation: SessionMutation,
    message: SessionMessage,
  ) => void;
}

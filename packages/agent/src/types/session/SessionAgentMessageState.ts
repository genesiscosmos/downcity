/**
 * Assistant Message 状态转换器的依赖类型。
 *
 * 该类型只暴露 canonical Message 运行时真正需要的协作能力：持久化边界与
 * Message 缓存。缓存是 SessionMessages 与本模块共享的唯一边界，两者都单向依赖它，
 * 不再需要互相回指的闭包。
 */

import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionMessageCache } from "@/session/messages/SessionMessageCache.js";

/** Assistant Message 状态转换器的构造参数。 */
export interface SessionAgentMessageStateOptions {
  /** 当前 Assistant Message 所属 Session 的稳定标识。 */
  session_id: string;
  /** 负责持久化 canonical Message 稳定检查点的 Store。 */
  store: SessionStorage;
  /** Message 运行缓存与 Mutation 发布边界。 */
  cache: SessionMessageCache;
}

/** Desktop Chat 可重建渲染缓存的生命周期类型。 */

/** 一次渲染缓存容量投影的输入。 */
export interface ChatRenderCacheProjectionInput {
  /** 当前实际持有消息渲染缓存的 Session 组合键。 */
  cached_session_keys: readonly string[];
  /** 按最近访问优先排列的 Session 组合键。 */
  recent_session_keys: readonly string[];
  /** 当前不可淘汰的激活或快照请求中 Session 组合键。 */
  protected_session_keys: ReadonlySet<string>;
  /** 除受保护 Session 外允许保留的最近 Session 数量。 */
  recent_cache_limit: number;
}

/** 一次渲染缓存容量投影的确定性结果。 */
export interface ChatRenderCacheProjection {
  /** 本轮应从 Renderer 删除的 Session 组合键。 */
  evicted_session_keys: string[];
  /** 清理淘汰项后仍需保留的最近访问顺序。 */
  recent_session_keys: string[];
}

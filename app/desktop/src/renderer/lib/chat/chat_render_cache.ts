/**
 * Desktop Chat 可重建渲染缓存的容量策略。
 *
 * 该模块只计算访问顺序与淘汰目标，不持有 React 状态。消息事实源仍属于
 * canonical Session；Renderer 淘汰后可在重新打开时通过 snapshot 完整恢复。
 */

import type { ChatRenderCacheProjection, ChatRenderCacheProjectionInput } from "@/types/ChatCache";

/** 除当前激活或请求中的 Session 外默认保留的最近渲染缓存数量。 */
export const recent_chat_render_cache_limit = 8;

/** 将一个 Session 移到最近访问顺序首位；已在首位时保留原引用。 */
export function touch_chat_render_cache(recent_session_keys: readonly string[], session_key: string): readonly string[] {
  if (recent_session_keys[0] === session_key) return recent_session_keys;
  return [session_key, ...recent_session_keys.filter((key) => key !== session_key)];
}

/** 根据最近访问顺序、容量和保护集合计算应淘汰的 Session 渲染缓存。 */
export function project_chat_render_cache(input: ChatRenderCacheProjectionInput): ChatRenderCacheProjection {
  const cached_session_keys = new Set(input.cached_session_keys);
  const retained_session_keys = new Set<string>();
  let retained_recent_count = 0;

  for (const session_key of input.recent_session_keys) {
    if (!cached_session_keys.has(session_key)) continue;
    if (input.protected_session_keys.has(session_key)) {
      retained_session_keys.add(session_key);
      continue;
    }
    if (retained_recent_count >= input.recent_cache_limit) continue;
    retained_session_keys.add(session_key);
    retained_recent_count += 1;
  }

  for (const session_key of input.cached_session_keys) {
    if (input.protected_session_keys.has(session_key)) retained_session_keys.add(session_key);
  }

  const evicted_session_keys = input.cached_session_keys.filter((key) => !retained_session_keys.has(key));
  const evicted_set = new Set(evicted_session_keys);
  return {
    evicted_session_keys,
    recent_session_keys: input.recent_session_keys.filter((key) => !evicted_set.has(key)),
  };
}

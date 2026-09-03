/**
 * MemoryPlugin 可信访问上下文解析器。
 *
 * 关键点（中文）
 * - Agent 与 Workspace 身份来自 PluginContext，不从用户文本推断。
 * - User 身份只接受 Embassy 验证后的 Federation 当前用户。
 * - 身份查询失败时降级为无 User Memory，不能猜测或使用默认用户。
 */

import type { PluginContext } from "@downcity/agent";
import type { MemoryAccessContext } from "@/memory/types/MemoryAccess.js";

/** 已认证 City 用户的最小缓存投影。 */
interface ResolvedCityUser {
  /** Federation 用户稳定标识。 */
  user_id: string;

  /** 用户 Token 当前绑定的 Bureau/City 标识。 */
  city_id: string;
}

/** MemoryPlugin 实例级访问上下文解析器。 */
export class MemoryAccessResolver {
  /** 当前 Plugin 是否具有 City 共享 Store。 */
  private readonly city_memory_available: boolean;

  /** 同一 Embassy 实例只执行一次正在进行中的身份查询。 */
  private readonly user_promises = new WeakMap<object, Promise<ResolvedCityUser | null>>();

  constructor(input: {
    /** 宿主是否提供 City Memory 根路径。 */
    city_memory_available: boolean;
  }) {
    this.city_memory_available = input.city_memory_available;
  }

  /** 从可信 Plugin 运行时能力生成当前 Memory 访问上下文。 */
  async resolve(
    context: PluginContext,
    session_id?: string,
  ): Promise<MemoryAccessContext> {
    const agent_id = String(context.agent_id || "").trim();
    if (!agent_id) throw new Error("Memory access requires agent_id");
    const workspace_id = String(context.workspace_id || "").trim();
    const normalized_session_id = String(session_id || "").trim();
    const user = this.city_memory_available
      ? await this.resolve_city_user(context)
      : null;
    return {
      agent_id,
      ...(workspace_id ? { workspace_id } : {}),
      ...(normalized_session_id ? { session_id: normalized_session_id } : {}),
      ...(user ? { user_id: user.user_id, city_id: user.city_id } : {}),
      city_memory_available: this.city_memory_available,
    };
  }

  /** 只使用 Embassy 已校验结果；失败时返回空身份并允许后续调用重试。 */
  private async resolve_city_user(
    context: PluginContext,
  ): Promise<ResolvedCityUser | null> {
    const embassy = context.embassy;
    if (!embassy) return null;
    const cache_key = embassy as object;
    const existing = this.user_promises.get(cache_key);
    if (existing) return await existing;
    const resolving = embassy.user.current()
      .then((current) => {
        const user_id = String(current.user.user_id || "").trim();
        const city_id = String(current.user.bureau_id || "").trim();
        return user_id && city_id ? { user_id, city_id } : null;
      })
      .catch(() => null);
    this.user_promises.set(cache_key, resolving);
    try {
      return await resolving;
    } finally {
      if (this.user_promises.get(cache_key) === resolving) {
        this.user_promises.delete(cache_key);
      }
    }
  }
}

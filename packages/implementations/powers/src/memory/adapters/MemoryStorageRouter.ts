/**
 * Agent 与 City Memory Store 的逻辑路由 Adapter。
 *
 * 关键点（中文）
 * - Provider 只看到一个带 owner/subject 前缀的逻辑 key 空间。
 * - Agent key 去往 Agent 私有 Adapter；City key 去往共享 City Adapter。
 * - Router 不理解 Memory 内容、权限或召回，只负责确定性的 Store 路由。
 */

import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

/** MemoryStorageRouter constructor 参数。 */
export interface MemoryStorageRouterOptions {
  /** 当前 Agent 的稳定编码标识。 */
  agent_segment: string;

  /** 当前 Agent 独享的 Storage Adapter。 */
  agent_storage: MemoryStorageAdapter;

  /** City 共享 Storage Adapter；未加入 City 时省略。 */
  city_storage?: MemoryStorageAdapter;
}

/** 把两个物理 Store 暴露为一个带所有权前缀的逻辑 key 空间。 */
export class MemoryStorageRouter implements MemoryStorageAdapter {
  /** Router 稳定名称。 */
  readonly name = "owner-router";

  /** 当前 Agent 的稳定编码标识。 */
  private readonly agent_segment: string;

  /** Agent 私有 Store。 */
  private readonly agent_storage: MemoryStorageAdapter;

  /** 可选 City 共享 Store。 */
  private readonly city_storage?: MemoryStorageAdapter;

  constructor(options: MemoryStorageRouterOptions) {
    this.agent_segment = normalize_segment(options.agent_segment);
    this.agent_storage = options.agent_storage;
    this.city_storage = options.city_storage;
  }

  /** 初始化全部已经装配的底层 Store。 */
  async initialize(): Promise<void> {
    await this.agent_storage.initialize();
    await this.city_storage?.initialize();
  }

  /** 判断一个完整逻辑 key 是否存在。 */
  async has(key: string): Promise<boolean> {
    const route = this.resolve_route(key);
    return await route.storage.has(route.inner_key);
  }

  /** 读取一个完整逻辑 key。 */
  async read(key: string): Promise<string | null> {
    const route = this.resolve_route(key);
    return await route.storage.read(route.inner_key);
  }

  /** 原子写入一个完整逻辑 key。 */
  async write(key: string, content: string): Promise<void> {
    const route = this.resolve_route(key);
    await route.storage.write(route.inner_key, content);
  }

  /** 在单个 owner 路由下列出条目，并恢复完整逻辑 key。 */
  async list(prefix: string): Promise<MemoryStorageEntry[]> {
    const route = this.resolve_route(prefix);
    const entries = await route.storage.list(route.inner_key);
    return entries.map((entry) => ({
      key: `${route.outer_prefix}/${entry.key}`,
      content: entry.content,
    }));
  }

  /** 删除一个完整逻辑 key。 */
  async delete(key: string): Promise<void> {
    const route = this.resolve_route(key);
    await route.storage.delete(route.inner_key);
  }

  /** 释放两个 Store；相同实例只释放一次。 */
  async dispose(): Promise<void> {
    await this.agent_storage.dispose();
    if (this.city_storage && this.city_storage !== this.agent_storage) {
      await this.city_storage.dispose();
    }
  }

  /** 解析完整 key 的 owner，并返回底层 Adapter key。 */
  private resolve_route(key: string): {
    /** 目标底层 Store。 */
    storage: MemoryStorageAdapter;
    /** 列表结果需要恢复的外部前缀。 */
    outer_prefix: string;
    /** 发送到底层 Store 的内部 key。 */
    inner_key: string;
  } {
    const normalized = normalize_key(key);
    const segments = normalized.split("/");
    if (segments[0] === "agent" && segments[1] === this.agent_segment) {
      const inner_key = segments.slice(2).join("/");
      if (!inner_key) throw new Error(`Invalid Agent Memory key: ${key}`);
      return {
        storage: this.agent_storage,
        outer_prefix: `agent/${this.agent_segment}`,
        inner_key,
      };
    }
    if (segments[0] === "city") {
      if (!this.city_storage) {
        throw new Error("City Memory Store is not available");
      }
      const inner_key = segments.slice(1).join("/");
      if (!inner_key) throw new Error(`Invalid City Memory key: ${key}`);
      return {
        storage: this.city_storage,
        outer_prefix: "city",
        inner_key,
      };
    }
    throw new Error(`Unsupported Memory owner key: ${key}`);
  }
}

/** 限制单个逻辑路径段。 */
function normalize_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!segment || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error(`Invalid Memory owner segment: ${value}`);
  }
  return segment;
}

/** 规范化 Router 逻辑 key。 */
function normalize_key(value: string): string {
  const key = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!key || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid Memory router key: ${value}`);
  }
  return key;
}

/**
 * Agent 私有与 City 共享 Memory Store 的物理路由 Adapter。
 *
 * 关键点（中文）
 * - Provider 只看到一个带 subject 前缀的逻辑 key 空间，物理布局对它不可见。
 * - Agent key 去往 `agents/<agent_id>/memory`，按 agent_id 懒加载并初始化独立 Adapter。
 * - City key 去往共享根 `powers/memory`，去掉前缀后与底层 key 完全一致。
 * - Router 不理解 Memory 内容、权限或召回，只负责确定性的双向映射。
 */

import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

/** Agent 私有根与共享根共有的命名空间。 */
const COMMON_NAMESPACES = ["wiki", "evidence"] as const;

/** Agent 私有根独有的命名空间。 */
const AGENT_ONLY_NAMESPACE = "capture-jobs";

/** MemoryStorageRouter constructor 参数。 */
export interface MemoryStorageRouterOptions {
  /** 跨 Agent 共享的 City Memory Store。 */
  shared_storage: MemoryStorageAdapter;

  /** 按 agent_id 创建 Agent 私有 Store 的工厂。 */
  create_agent_storage: (agent_id: string) => MemoryStorageAdapter;
}

/** 把 Agent 私有根与共享根暴露为一个带 subject 前缀的逻辑 key 空间。 */
export class MemoryStorageRouter implements MemoryStorageAdapter {
  /** Router 稳定名称。 */
  readonly name = "owner-router";

  /** 跨 Agent 共享 Store。 */
  private readonly shared_storage: MemoryStorageAdapter;

  /** Agent 私有 Store 工厂。 */
  private readonly create_agent_storage: (agent_id: string) => MemoryStorageAdapter;

  /** 已经创建并初始化完成的 Agent 私有 Store。 */
  private readonly agent_storages = new Map<string, MemoryStorageAdapter>();

  constructor(options: MemoryStorageRouterOptions) {
    if (typeof options.create_agent_storage !== "function") {
      throw new Error("MemoryStorageRouter requires create_agent_storage");
    }
    this.shared_storage = options.shared_storage;
    this.create_agent_storage = options.create_agent_storage;
  }

  /** 初始化共享根；Agent 私有根在首次访问时按需创建。 */
  async initialize(): Promise<void> {
    await this.shared_storage.initialize();
  }

  /** 判断一个完整逻辑 key 是否存在。 */
  async has(key: string): Promise<boolean> {
    const route = await this.resolve_route(key);
    return await route.storage.has(route.inner_key);
  }

  /** 读取一个完整逻辑 key。 */
  async read(key: string): Promise<string | null> {
    const route = await this.resolve_route(key);
    return await route.storage.read(route.inner_key);
  }

  /** 原子写入一个完整逻辑 key。 */
  async write(key: string, content: string): Promise<void> {
    const route = await this.resolve_route(key);
    await route.storage.write(route.inner_key, content);
  }

  /** 枚举一个逻辑前缀下的条目，并把底层 key 还原为完整逻辑 key。 */
  async list(prefix: string): Promise<MemoryStorageEntry[]> {
    const route = await this.resolve_route(prefix);
    const collected = (await Promise.all(route.list_namespaces.map(async (namespace) => {
      const entries = await route.storage.list(namespace);
      return entries.map((entry) => ({
        key: `${route.outer_prefix}/${entry.key}`,
        content: entry.content,
      }));
    }))).flat();
    return collected.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 删除一个完整逻辑 key。 */
  async delete(key: string): Promise<void> {
    const route = await this.resolve_route(key);
    await route.storage.delete(route.inner_key);
  }

  /** 释放共享根与全部已经创建的 Agent 私有根。 */
  async dispose(): Promise<void> {
    await this.shared_storage.dispose();
    for (const storage of this.agent_storages.values()) {
      if (storage === this.shared_storage) continue;
      await storage.dispose();
    }
    this.agent_storages.clear();
  }

  /** 解析完整逻辑 key 的物理归属与双向映射。 */
  private async resolve_route(key: string): Promise<ResolvedMemoryRoute> {
    const segments = normalize_key(key).split("/");
    if (segments[0] === "agent") {
      const agent_id = normalize_segment(segments[1] || "");
      const relative = segments.slice(2);
      return {
        storage: await this.require_agent_storage(agent_id),
        inner_key: relative.join("/"),
        list_namespaces: relative.length === 0
          ? [...COMMON_NAMESPACES, AGENT_ONLY_NAMESPACE]
          : [relative[0] || ""],
        outer_prefix: `agent/${agent_id}`,
      };
    }
    if (segments[0] === "city") {
      const relative = segments.slice(1);
      return {
        storage: this.shared_storage,
        inner_key: relative.join("/"),
        list_namespaces: relative.length === 0
          ? [...COMMON_NAMESPACES]
          : [relative[0] || ""],
        outer_prefix: "city",
      };
    }
    throw new Error(`Unsupported Memory subject key: ${key}`);
  }

  /** 返回指定 Agent 已经初始化完成的私有 Store。 */
  private async require_agent_storage(agent_id: string): Promise<MemoryStorageAdapter> {
    const existing = this.agent_storages.get(agent_id);
    if (existing) return existing;
    const created = this.create_agent_storage(agent_id);
    this.agent_storages.set(agent_id, created);
    try {
      await created.initialize();
    } catch (error) {
      this.agent_storages.delete(agent_id);
      throw error;
    }
    return created;
  }
}

/** 一次逻辑 key 解析后的物理路由与双向映射。 */
interface ResolvedMemoryRoute {
  /** 目标底层 Store。 */
  storage: MemoryStorageAdapter;

  /** 发送到底层 Store 的内部 key。 */
  inner_key: string;

  /** 枚举时需要列出的底层命名空间。 */
  list_namespaces: string[];

  /** 把底层条目 key 还原为完整逻辑 key 时使用的前缀。 */
  outer_prefix: string;
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

/**
 * User、Agent 与 Workspace Memory Store 的物理路由 Adapter。
 *
 * 关键点（中文）
 * - Provider 只看到一个带范围前缀的逻辑 key 空间，物理布局对它不可见。
 * - Agent key 去往 `agents/<agent_id>/memory`，按 agent_id 懒加载并初始化独立 Adapter。
 * - Workspace key 去往共享根 `powers/memory/workspaces/<hex>`，物理布局保持稳定。
 * - Router 不理解 Memory 内容、权限或召回，只负责确定性的双向映射。
 */

import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

/** MemoryStorageRouter constructor 参数。 */
export interface MemoryStorageRouterOptions {
  /** 承载 Workspace 范围的共享 Memory Store。 */
  shared_storage: MemoryStorageAdapter;

  /** 平台唯一使用者的独立 memory 目录。 */
  user_storage: MemoryStorageAdapter;

  /** 按 agent_id 创建 Agent 私有 Store 的工厂。 */
  create_agent_storage: (agent_id: string) => MemoryStorageAdapter;
}

/** 把 Agent 私有根与共享根暴露为一个带范围前缀的逻辑 key 空间。 */
export class MemoryStorageRouter implements MemoryStorageAdapter {
  /** Router 稳定名称。 */
  readonly name = "owner-router";

  /** 跨 Agent 共享 Store。 */
  private readonly shared_storage: MemoryStorageAdapter;

  /** 本地 User 独立 Store。 */
  private readonly user_storage: MemoryStorageAdapter;

  /** Agent 私有 Store 工厂。 */
  private readonly create_agent_storage: (agent_id: string) => MemoryStorageAdapter;

  /** 已经创建并初始化完成的 Agent 私有 Store。 */
  private readonly agent_storages = new Map<string, MemoryStorageAdapter>();

  constructor(options: MemoryStorageRouterOptions) {
    if (typeof options.create_agent_storage !== "function") {
      throw new Error("MemoryStorageRouter requires create_agent_storage");
    }
    this.shared_storage = options.shared_storage;
    this.user_storage = options.user_storage;
    this.create_agent_storage = options.create_agent_storage;
  }

  /** 初始化共享根；Agent 私有根在首次访问时按需创建。 */
  async initialize(): Promise<void> {
    await this.shared_storage.initialize();
    await this.user_storage.initialize();
  }

  /** 判断一个完整逻辑 key 是否存在。 */
  async has(key: string): Promise<boolean> {
    const route = await this.resolve_route(key);
    return await route.storage.has(route.inner_key);
  }

  /** 探针直达完整物理前缀，不使用只枚举部分命名空间的 list 路径。 */
  async has_entries(prefix: string): Promise<boolean> {
    const route = await this.resolve_route(prefix);
    return await route.storage.has_entries(route.inner_key.replace(/\/$/u, ""));
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
    const collected = (await route.storage.list(route.inner_key)).map((entry) => {
      const physical_prefix = route.inner_prefix ? `${route.inner_prefix}/` : "";
      if (!entry.key.startsWith(physical_prefix)) throw new Error("Memory list entry escapes physical scope");
      const relative_key = entry.key.slice(physical_prefix.length);
      return { key: `${route.outer_prefix}/${relative_key}`, content: entry.content };
    });
    return collected.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 删除一个完整逻辑 key。 */
  async delete(key: string): Promise<void> {
    const route = await this.resolve_route(key);
    await route.storage.delete(route.inner_key);
  }

  /** 把范围排他锁路由到实际物理存储，所有写者共享同一个锁键。 */
  async with_scope_lock<T>(scope_key: string, operation: () => Promise<T>): Promise<T> {
    const route = await this.resolve_route(scope_key);
    return await route.storage.with_scope_lock(route.inner_key, operation);
  }

  /** 释放共享根与全部已经创建的 Agent 私有根。 */
  async dispose(): Promise<void> {
    await this.shared_storage.dispose();
    await this.user_storage.dispose();
    for (const storage of this.agent_storages.values()) {
      if (storage === this.shared_storage) continue;
      await storage.dispose();
    }
    this.agent_storages.clear();
  }

  /** 解析完整逻辑 key 的物理归属与双向映射。 */
  private async resolve_route(key: string): Promise<ResolvedMemoryRoute> {
    const segments = normalize_key(key).split("/");
    const scope = segments[0];
    const scope_id = normalize_segment(segments[1] || "");
    const relative_key = segments.slice(2).join("/");
    if (scope === "agent" || scope === "user" || scope === "workspace") {
      const inner_prefix = scope === "workspace" ? `workspaces/${scope_id}` : "";
      return {
        storage: scope === "agent" ? await this.require_agent_storage(scope_id)
          : scope === "user" ? this.user_storage : this.shared_storage,
        inner_key: [inner_prefix, relative_key].filter(Boolean).join("/"),
        inner_prefix,
        outer_prefix: `${scope}/${scope_id}`,
      };
    }
    throw new Error(`Unsupported Memory scope key: ${key}`);
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

  /** 当前范围在底层 Store 的物理根前缀，User 与 Agent 使用空前缀。 */
  inner_prefix: string;

  /** 把底层条目 key 还原为完整逻辑 key 时使用的前缀。 */
  outer_prefix: string;
}

/** 限制单个逻辑路径段。 */
function normalize_segment(value: string): string {
  const segment = value;
  if (!segment || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error(`Invalid Memory scope segment: ${value}`);
  }
  return segment;
}

/** 严格校验 Router 逻辑 key（范围前缀与内部路径均可）。 */
function normalize_key(value: string): string {
  const key = value;
  if (!key || /[\\\s]/u.test(key) || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid Memory router key: ${value}`);
  }
  return key;
}

/**
 * Agent 私有与共享 Memory Store 的物理路由 Adapter。
 *
 * 关键点（中文）
 * - Provider 只看到一个带 subject 前缀的逻辑 key 空间，物理布局对它不可见。
 * - Agent key 去往 `agents/<agent_id>/memory`，按 agent_id 懒加载独立 Adapter。
 * - 其余 key 去往共享根 `powers/memory`，subject 被压进文件名以实现单层平铺。
 * - 共享文件名带 subject 前缀，因此不同 User 或 Workspace 的同名记忆不会互相覆盖。
 * - Router 不理解 Memory 内容、权限或召回，只负责确定性的双向映射。
 */

import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

/** Agent 私有根独有的命名空间。 */
const AGENT_ONLY_NAMESPACE = "capture-jobs";

/** Agent 私有根与共享根共有的命名空间。 */
const COMMON_NAMESPACES = ["wiki", "evidence"] as const;

/** MemoryStorageRouter constructor 参数。 */
export interface MemoryStorageRouterOptions {
  /** 跨 Agent 共享的 Memory Store。 */
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

  /**
   * 枚举一个逻辑前缀下的条目。
   *
   * 关键点（中文）：共享根的 subject 被压进文件名，无法按目录前缀枚举，因此这里先列出
   * 命名空间目录，再按 subject token 过滤并还原为完整逻辑 key。
   */
  async list(prefix: string): Promise<MemoryStorageEntry[]> {
    const route = this.resolve_route(prefix);
    const collected = (await Promise.all(route.list_namespaces.map(async (namespace) => {
      const entries = await route.storage.list(namespace);
      return entries.flatMap((entry) => {
        const outer_key = route.to_outer_key(entry.key);
        return outer_key ? [{ key: outer_key, content: entry.content }] : [];
      });
    }))).flat();
    return collected.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 删除一个完整逻辑 key。 */
  async delete(key: string): Promise<void> {
    const route = this.resolve_route(key);
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
  private resolve_route(key: string): ResolvedMemoryRoute {
    const segments = normalize_key(key).split("/");
    return segments[0] === "agent"
      ? this.resolve_agent_route(segments)
      : this.resolve_shared_route(key, segments);
  }

  /** 解析 Agent 私有路由；内部 key 与逻辑相对路径完全一致。 */
  private resolve_agent_route(segments: string[]): ResolvedMemoryRoute {
    const agent_id = normalize_segment(segments[1] || "");
    const relative = segments.slice(2);
    const outer_prefix = `agent/${agent_id}`;
    return {
      storage: this.require_agent_storage(agent_id),
      inner_key: relative.join("/"),
      list_namespaces: relative.length === 0
        ? [...COMMON_NAMESPACES, AGENT_ONLY_NAMESPACE]
        : [relative[0] || ""],
      to_outer_key: (candidate) => candidate
        ? `${outer_prefix}/${normalize_key(candidate)}`
        : null,
    };
  }

  /** 解析共享路由；subject 被压进文件名，逻辑前缀只保留 subject 语义。 */
  private resolve_shared_route(logical_key: string, segments: string[]): ResolvedMemoryRoute {
    const subject = resolve_shared_subject(segments);
    if (!subject) throw new Error(`Unsupported Memory subject key: ${logical_key}`);
    const relative = segments.slice(subject.consumed_segments);
    const namespace = relative[0] || "";
    const name = relative.slice(1).join("-");
    if (relative.length > 1 && !name) {
      throw new Error(`Invalid shared Memory key: ${logical_key}`);
    }
    // 只给出命名空间时表示枚举该命名空间，而不是指向一个具体文件。
    const has_file_name = relative.length > 1;
    return {
      storage: this.shared_storage,
      inner_key: has_file_name ? `${namespace}/${subject.file_token}-${name}` : "",
      list_namespaces: namespace ? [namespace] : [...COMMON_NAMESPACES],
      to_outer_key: (candidate) => {
        if (!candidate) return null;
        const candidate_segments = normalize_key(candidate).split("/");
        const candidate_namespace = candidate_segments[0] || "";
        const candidate_name = candidate_segments.slice(1).join("-");
        const token_prefix = `${subject.file_token}-`;
        if (!candidate_name.startsWith(token_prefix)) return null;
        const restored_name = candidate_name.slice(token_prefix.length);
        if (!restored_name) return null;
        return `${subject.logical_prefix}/${candidate_namespace}/${restored_name}`;
      },
    };
  }

  /** 返回指定 Agent 已经初始化完成的私有 Store。 */
  private require_agent_storage(agent_id: string): MemoryStorageAdapter {
    const existing = this.agent_storages.get(agent_id);
    if (existing) return existing;
    const created = this.create_agent_storage(agent_id);
    this.agent_storages.set(agent_id, created);
    // 首次访问时建立根目录；initialize 只做 mkdir，代价有界。
    void created.initialize().catch(() => undefined);
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

  /** 把底层条目 key 还原为完整逻辑 key；不属于当前 subject 时返回 null。 */
  to_outer_key: (inner_key: string) => string | null;
}

/** 共享 key 的 subject 归属。 */
interface SharedSubjectRoute {
  /** 当前 subject 占用的逻辑段数量。 */
  consumed_segments: number;

  /** 写入物理文件名时使用的 subject 前缀。 */
  file_token: string;

  /** 还原逻辑 key 时使用的前缀。 */
  logical_prefix: string;
}

/** 解析共享 key 的 subject 段。 */
function resolve_shared_subject(segments: string[]): SharedSubjectRoute | null {
  const head = segments[0];
  if (head === "user" || head === "workspace") {
    const identity = normalize_segment(segments[1] || "");
    return {
      consumed_segments: 2,
      file_token: `${head}-${identity}`,
      logical_prefix: `${head}/${identity}`,
    };
  }
  if (head === "city") {
    return { consumed_segments: 1, file_token: "city", logical_prefix: "city" };
  }
  return null;
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

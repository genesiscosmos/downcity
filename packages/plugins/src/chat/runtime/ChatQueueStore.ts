/**
 * ChatQueueStore：chat plugin runtime 队列存储。
 *
 * 关键点（中文）
 * - 这是 chat queue 的实例级状态容器。
 * - 允许 `ChatPlugin` 持有自己的 queue store，而不是完全依赖模块级全局状态。
 * - 旧的 `ChatQueue.ts` 会保留共享门面，逐步迁移到显式实例注入。
 */

import type { PluginContext } from "@downcity/agent";
import type {
  ChatQueueEnqueueParams,
  ChatQueueEnqueueResult,
  ChatQueueItem,
} from "@/chat/types/ChatQueue.js";

/**
 * 入队监听器。
 */
export type ChatQueueEnqueueListener = (laneKey: string) => void;

/**
 * ChatPlugin queue store 的最小能力接口。
 */
export interface ChatQueueStorePort {
  /**
   * 订阅入队事件。
   */
  onEnqueue(listener: ChatQueueEnqueueListener): () => void;
  /**
   * 入队。
   */
  enqueue(params: ChatQueueEnqueueParams): ChatQueueEnqueueResult;
  /**
   * 弹出一条队列项。
   */
  shift(laneKey: string): ChatQueueItem | null;
  /**
   * drain 指定 lane。
   */
  drain(laneKey: string, maxItems?: number): ChatQueueItem[];
  /**
   * 列出当前 lane keys。
   */
  listLanes(): string[];
  /**
   * 查询某个 lane 的长度。
   */
  getLaneSize(laneKey: string): number;
  /**
   * 清空某个 lane。
   */
  clear(laneKey: string): void;
}

/**
 * 共享 queue store。
 *
 * 关键点（中文）
 * - 迁移阶段仍保留一份共享实例，避免一次性改动所有旧入口。
 * - 新代码应优先通过 `PluginContext.agent` 解析显式 queue store。
 */
/**
 * Chat queue 实例级存储。
 */
export class ChatQueueStore implements ChatQueueStorePort {
  private readonly lanes: Map<string, ChatQueueItem[]> = new Map();
  private readonly listeners: Set<ChatQueueEnqueueListener> = new Set();
  private nextSeq = 1;

  private generateItemId(): string {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return `q:${Date.now().toString(36)}:${seq.toString(36)}`;
  }

  private getLane(key: string): ChatQueueItem[] {
    const lane = this.lanes.get(key);
    if (lane) return lane;
    const created: ChatQueueItem[] = [];
    this.lanes.set(key, created);
    return created;
  }

  private normalizeLaneKey(raw: string): string {
    const key = String(raw || "").trim();
    if (!key) throw new Error("ChatQueueStore requires a non-empty lane key");
    return key;
  }

  onEnqueue(listener: ChatQueueEnqueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueue(params: ChatQueueEnqueueParams): ChatQueueEnqueueResult {
    const laneKey = this.normalizeLaneKey(params.session_id);
    const lane = this.getLane(laneKey);
    const item: ChatQueueItem = {
      ...params,
      id: this.generateItemId(),
      enqueuedAt: Date.now(),
      kind: params.kind ?? "exec",
    };
    lane.push(item);
    for (const listener of this.listeners) {
      try {
        listener(laneKey);
      } catch {
        // ignore listener failure
      }
    }
    return {
      lanePosition: lane.length,
      itemId: item.id,
    };
  }

  shift(laneKey: string): ChatQueueItem | null {
    const key = this.normalizeLaneKey(laneKey);
    const lane = this.lanes.get(key);
    if (!lane || lane.length === 0) return null;
    const item = lane.shift() || null;
    if (lane.length === 0) this.lanes.delete(key);
    return item;
  }

  drain(laneKey: string, maxItems?: number): ChatQueueItem[] {
    const key = this.normalizeLaneKey(laneKey);
    const lane = this.lanes.get(key);
    if (!lane || lane.length === 0) return [];

    if (typeof maxItems === "number" && maxItems > 0 && maxItems < lane.length) {
      return lane.splice(0, Math.floor(maxItems));
    }

    this.lanes.delete(key);
    return lane.splice(0, lane.length);
  }

  listLanes(): string[] {
    return Array.from(this.lanes.keys());
  }

  getLaneSize(laneKey: string): number {
    const key = String(laneKey || "").trim();
    if (!key) return 0;
    const lane = this.lanes.get(key);
    return lane ? lane.length : 0;
  }

  clear(laneKey: string): void {
    const key = String(laneKey || "").trim();
    if (!key) return;
    this.lanes.delete(key);
  }
}

const sharedChatQueueStore = new ChatQueueStore();

/**
 * 读取共享 chat queue store。
 */
export function getSharedChatQueueStore(): ChatQueueStore {
  return sharedChatQueueStore;
}

/**
 * 从运行时解析 chat queue store。
 *
 * 关键点（中文）
 * - 新路径优先读取当前 Agent 注册的 ChatPlugin 实例。
 * - 迁移阶段若拿不到，则回退到共享 queue store，保证旧入口可继续工作。
 */
export function resolveChatQueueStore(context?: PluginContext): ChatQueueStorePort {
  const chatService = context?.plugins.get("chat") as
    | { queue_store?: (context: PluginContext) => ChatQueueStorePort }
    | undefined;
  if (chatService?.queue_store && context) {
    return chatService.queue_store(context);
  }
  return sharedChatQueueStore;
}

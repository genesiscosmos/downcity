/**
 * ChatQueueStore：chat plugin runtime 队列存储。
 *
 * 关键点（中文）
 * - 这是 chat queue 的实例级状态容器。
 * - `ChatPlugin` 为每个 Workspace Context 持有独立 queue store。
 * - 队列必须通过显式 Context 解析，不允许模块级共享状态。
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

/**
 * 从运行时解析 chat queue store。
 *
 * 关键点（中文）
 * - 只读取当前 Agent 注册的 ChatPlugin 实例。
 * - 缺少 Context 或对应 Workspace runtime 时立即失败，避免跨 Agent/Workspace 串队列。
 */
export function resolveChatQueueStore(context: PluginContext): ChatQueueStorePort {
  const chatService = context.plugins.get("chat") as
    | { queue_store?: (context: PluginContext) => ChatQueueStorePort }
    | undefined;
  if (!chatService?.queue_store) {
    throw new Error("Chat queue requires an active ChatPlugin for the current Workspace");
  }
  return chatService.queue_store(context);
}

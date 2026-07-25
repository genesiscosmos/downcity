/**
 * Workboard 快照缓存。
 *
 * 关键点（中文）
 * - 采用惰性启动 + 周期刷新，避免首次请求前就常驻占用资源。
 * - route 与 action 共享同一份快照，确保 workboard 展示一致。
 */

import type { PluginContext } from "@downcity/agent";
import type { WorkboardSnapshot } from "@/workboard/types/Workboard.js";
import { collectWorkboardSnapshot } from "@/workboard/runtime/Collector.js";

type PluginContextResolver = () => PluginContext;

const DEFAULT_WORKBOARD_INTERVAL_MS = 5_000;

/**
 * Workboard 快照存储器。
 */
class WorkboardSnapshotStore {
  private contextResolver: PluginContextResolver;

  private readonly intervalMs: number;

  private latestSnapshot: WorkboardSnapshot | null = null;

  private refreshTimer: NodeJS.Timeout | null = null;

  private inflight: Promise<WorkboardSnapshot> | null = null;

  constructor(params: {
    contextResolver: PluginContextResolver;
    intervalMs?: number;
  }) {
    this.contextResolver = params.contextResolver;
    this.intervalMs = params.intervalMs || DEFAULT_WORKBOARD_INTERVAL_MS;
  }

  /**
   * 更新上下文 resolver。
   */
  setContextResolver(resolver: PluginContextResolver): void {
    this.contextResolver = resolver;
  }

  /**
   * 读取当前快照。
   */
  async readSnapshot(): Promise<WorkboardSnapshot> {
    this.ensureStarted();
    if (this.latestSnapshot) {
      return this.latestSnapshot;
    }
    return this.refresh();
  }

  /**
   * 立即刷新一次快照。
   */
  async refresh(): Promise<WorkboardSnapshot> {
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = collectWorkboardSnapshot(this.contextResolver())
      .then((snapshot) => {
        this.latestSnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  /**
   * 惰性启动后台刷新。
   */
  private ensureStarted(): void {
    if (this.refreshTimer) {
      return;
    }

    void this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    this.refreshTimer.unref?.();
  }
}

let sharedStore: WorkboardSnapshotStore | null = null;

/**
 * 读取共享 workboard 快照缓存。
 */
export function getWorkboardSnapshotStore(params: {
  contextResolver: PluginContextResolver;
}): WorkboardSnapshotStore {
  if (!sharedStore) {
    sharedStore = new WorkboardSnapshotStore({
      contextResolver: params.contextResolver,
    });
    return sharedStore;
  }

  sharedStore.setContextResolver(params.contextResolver);
  return sharedStore;
}

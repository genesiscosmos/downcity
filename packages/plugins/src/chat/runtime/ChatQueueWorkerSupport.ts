/**
 * ChatQueueWorkerSupport：chat queue worker 的通用辅助模块。
 *
 * 关键点（中文）
 * - 收敛 burst merge、错误文本构造、worker 配置归一化等辅助逻辑。
 * - 这些逻辑与 lane 调度主流程正交，拆出后让 ChatQueueWorker 更聚焦。
 */

import type { ChatQueueWorkerConfig } from "@/chat/types/ChatQueueWorker.js";
import type { ChatQueueItem } from "@/chat/types/ChatQueue.js";
import type { ChatQueueStorePort } from "./ChatQueueStore.js";

const CHANNEL_ERROR_TEXT_MAX_LENGTH = 480;
const DEFAULT_MERGE_DEBOUNCE_MS = 600;
const DEFAULT_MERGE_MAX_WAIT_MS = 2_000;
const BURST_MERGE_POLL_INTERVAL_MS = 20;

/**
 * 归一化 worker 配置。
 */
export function normalizeChatQueueWorkerConfig(
  input?: Partial<ChatQueueWorkerConfig>,
): ChatQueueWorkerConfig {
  const max_concurrency =
    typeof input?.max_concurrency === "number" && Number.isFinite(input.max_concurrency)
      ? Math.max(1, Math.min(32, Math.floor(input.max_concurrency)))
      : 2;

  const merge_debounce_ms =
    typeof input?.merge_debounce_ms === "number" &&
    Number.isFinite(input.merge_debounce_ms)
      ? Math.max(0, Math.min(60_000, Math.floor(input.merge_debounce_ms)))
      : DEFAULT_MERGE_DEBOUNCE_MS;

  const merge_max_wait_ms =
    typeof input?.merge_max_wait_ms === "number" &&
    Number.isFinite(input.merge_max_wait_ms)
      ? Math.max(0, Math.min(120_000, Math.floor(input.merge_max_wait_ms)))
      : DEFAULT_MERGE_MAX_WAIT_MS;

  return { max_concurrency, merge_debounce_ms, merge_max_wait_ms };
}

/**
 * 判断是否启用“启动前消息合并”。
 */
export function isBurstMergeEnabled(config: ChatQueueWorkerConfig): boolean {
  return config.merge_debounce_ms > 0 && config.merge_max_wait_ms > 0;
}

/**
 * 判断是否为上游模型服务临时不可用。
 */
export function isTemporaryModelServiceUnavailable(error: unknown): boolean {
  const msg = String(error ?? "");
  return (
    /Service temporarily unavailable/i.test(msg) ||
    /AI_RetryError/i.test(msg) ||
    /maxRetriesExceeded/i.test(msg) ||
    /\b503\b/.test(msg)
  );
}

/**
 * 构造回发到 channel 的失败文本。
 */
export function buildChannelErrorText(error: unknown): string {
  const raw = String(error ?? "").trim();
  if (/AI_APICallError/i.test(raw)) {
    return raw || "AI_APICallError";
  }

  if (isTemporaryModelServiceUnavailable(error)) {
    return "⚠️ 模型服务暂时不可用（503），系统已自动重试但仍失败，请稍后再试。";
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (/AI_NoOutputGeneratedError|No output generated/i.test(normalized)) {
    return "❌ 模型本轮没有生成可发送内容。系统已记录底层 stream 错误，请稍后重试。";
  }

  if (!normalized) {
    return "❌ 执行失败，请稍后重试。";
  }

  const clipped =
    normalized.length > CHANNEL_ERROR_TEXT_MAX_LENGTH
      ? `${normalized.slice(0, CHANNEL_ERROR_TEXT_MAX_LENGTH)}…`
      : normalized;
  return `❌ 执行失败：${clipped}`;
}

/**
 * 等待一小段时间，让同 lane 的连续消息尽量在一次队列处理前合并。
 */
export async function collectInitialBurstItems(params: {
  laneKey: string;
  first: ChatQueueItem;
  config: ChatQueueWorkerConfig;
  queueStore: ChatQueueStorePort;
}): Promise<ChatQueueItem[]> {
  if (params.first.kind !== "exec") return [params.first];
  if (!isBurstMergeEnabled(params.config)) return [params.first];

  const startedAt = Date.now();
  let lastInboundAt = startedAt;
  let knownLaneSize = params.queueStore.getLaneSize(params.laneKey);

  while (true) {
    const now = Date.now();
    const idleMs = now - lastInboundAt;
    const elapsedMs = now - startedAt;
    if (idleMs >= params.config.merge_debounce_ms) break;
    if (elapsedMs >= params.config.merge_max_wait_ms) break;

    const remainingDebounceMs = params.config.merge_debounce_ms - idleMs;
    const remainingMaxWaitMs = params.config.merge_max_wait_ms - elapsedMs;
    const sleepMs = Math.max(
      1,
      Math.min(
        BURST_MERGE_POLL_INTERVAL_MS,
        remainingDebounceMs,
        remainingMaxWaitMs,
      ),
    );

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, sleepMs);
      if (typeof timer.unref === "function") timer.unref();
    });

    const laneSize = params.queueStore.getLaneSize(params.laneKey);
    if (laneSize > knownLaneSize) {
      knownLaneSize = laneSize;
      lastInboundAt = Date.now();
    }
  }

  const drained = params.queueStore.drain(params.laneKey);
  return drained.length > 0 ? [params.first, ...drained] : [params.first];
}

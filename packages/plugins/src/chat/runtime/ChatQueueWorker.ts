/**
 * ChatQueueWorker：chat plugin runtime 侧队列执行器。
 *
 * 关键点（中文）
 * - 消费 chat plugin runtime 持有的队列模块
 * - 只负责把 lane 中的新输入持续提交给 `session.prompt()`
 * - turn 并入策略、history 落盘、assistant 收敛统一交给 Session
 */

import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { ChatQueueWorkerConfig } from "@/chat/types/ChatQueueWorker.js";
import type { ChatQueueItem } from "@/chat/types/ChatQueue.js";
import type { SessionMutation } from "@downcity/agent";
import type { AgentSessionTurnResult } from "@downcity/agent";
import {
  getSharedChatQueueStore,
} from "./ChatQueue.js";
import { getChatSender } from "./ChatSendRegistry.js";
import {
  buildChannelErrorText,
  collectInitialBurstItems,
  normalizeChatQueueWorkerConfig,
} from "./ChatQueueWorkerSupport.js";
import type { ChatQueueStorePort } from "./ChatQueueStore.js";
import {
  dispatchAssistantTextDirect,
  dispatchTextToChannel,
} from "./ChatQueueReplyDispatch.js";

const TYPING_ACTION_INTERVAL_MS = 4_000;

type LaneState = {
  key: string;
  running: boolean;
  turnObservers: Map<string, TurnObservation>;
  assistantTextByMessageId: Map<string, string>;
  unsubscribeSessionEvents?: () => void;
};

type TurnObservation = {
  turn_id: string;
  session_id: string;
  message_id?: string;
  typing: { stop: () => void };
};

export class ChatQueueWorker {
  private readonly logger: Logger;
  private readonly context: PluginContext;
  private readonly config: ChatQueueWorkerConfig;
  private readonly queueStore: ChatQueueStorePort;

  private readonly lanes: Map<string, LaneState> = new Map();
  private readonly runnable: string[] = [];
  private readonly runnableSet: Set<string> = new Set();
  private runningTotal: number = 0;
  private unsubscribe?: () => void;
  private stopped = false;

  constructor(params: {
    logger: Logger;
    context: PluginContext;
    queueStore?: ChatQueueStorePort;
    config?: Partial<ChatQueueWorkerConfig>;
  }) {
    this.logger = params.logger;
    this.context = params.context;
    this.config = normalizeChatQueueWorkerConfig(params.config);
    this.queueStore = params.queueStore || getSharedChatQueueStore();
  }

  /**
   * 启动 worker。
   */
  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    this.unsubscribe = this.queueStore.onEnqueue((laneKey) => {
      this.markRunnable(laneKey);
      void this.requestTurnCancelIfSupported(laneKey);
      void this.kick();
    });

    // 初始化已有 lanes
    for (const laneKey of this.queueStore.listLanes()) {
      this.markRunnable(laneKey);
    }
    void this.kick();
  }

  /**
   * 停止 worker（不清队列）。
   */
  stop(): void {
    this.stopped = true;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = undefined;
  }

  private getOrCreateLane(key: string): LaneState {
    const existing = this.lanes.get(key);
    if (existing) return existing;
    const lane: LaneState = {
      key,
      running: false,
      turnObservers: new Map(),
      assistantTextByMessageId: new Map(),
    };
    this.lanes.set(key, lane);
    return lane;
  }

  private markRunnable(key: string): void {
    if (this.runnableSet.has(key)) return;
    this.runnableSet.add(key);
    this.runnable.push(key);
  }

  private pickNextRunnableLane(): LaneState | null {
    while (this.runnable.length > 0) {
      const key = this.runnable.shift()!;
      this.runnableSet.delete(key);
      const lane = this.getOrCreateLane(key);
      if (lane.running) continue;
      if (this.queueStore.getLaneSize(key) === 0) continue;
      return lane;
    }
    return null;
  }

  private async kick(): Promise<void> {
    if (this.stopped) return;
    while (this.runningTotal < this.config.max_concurrency) {
      const lane = this.pickNextRunnableLane();
      if (!lane) return;

      lane.running = true;
      this.runningTotal += 1;
      void this.runLaneOnce(lane)
        .catch((err) => {
          this.logger.error(`ChatQueueWorker lane failed: ${String(err)}`);
        })
        .finally(() => {
          lane.running = false;
          this.runningTotal -= 1;
          if (!this.stopped) {
            if (this.queueStore.getLaneSize(lane.key) > 0) {
              this.markRunnable(lane.key);
            }
            void this.kick();
          }
        });
    }
  }

  private async runLaneOnce(lane: LaneState): Promise<void> {
    const first = this.queueStore.shift(lane.key);
    if (!first) return;
    await this.processOne(lane.key, first);
  }

  /**
   * 若底层 runtime 支持取消当前 turn，则在新消息入队时立刻触发。
   *
   * 关键点（中文）
   * - 只对支持显式取消的 runtime 生效（主要是 ACP）。
   * - 失败不影响正常排队；worker 仍会走串行兜底。
   */
  private async requestTurnCancelIfSupported(session_id: string): Promise<void> {
    const sessionKey = String(session_id || "").trim();
    if (!sessionKey) return;
    try {
      // ACP executor removed; cancel is no longer supported through session executor port.
    } catch {
      // ignore

      return;
      // ignore
    }
  }

  private handleControl(item: ChatQueueItem): boolean {
    const control = item.control;
    if (!control) return false;
    if (control.type === "clear") {
      this.queueStore.clear(item.session_id);
      return true;
    }
    return false;
  }

  /**
   * 在单次执行期间维持“正在输入”心跳。
   *
   * 关键点（中文）
   * - 通过 chat plugin runtime 的 dispatcher 发送动作（不经过 main bindings）
   * - 先发送一次，再按固定间隔续发
   * - 发送失败不影响主执行流程（best-effort）
   */
  private startTypingHeartbeat(item: ChatQueueItem): { stop: () => void } {
    const chatId = String(item.targetId || "").trim();
    if (!chatId) return { stop: () => {} };

    const dispatcher = getChatSender(item.channel);
    const sendAction = dispatcher?.sendAction;
    if (typeof sendAction !== "function") {
      return { stop: () => {} };
    }

    const sendOnce = async () => {
      try {
        await sendAction({
          chatId,
          action: "typing",
          ...(typeof item.threadId === "number"
            ? { messageThreadId: item.threadId }
            : {}),
          ...(typeof item.targetType === "string" && item.targetType
            ? { chatType: item.targetType }
            : {}),
          ...(typeof item.message_id === "string" && item.message_id
            ? { message_id: item.message_id }
            : {}),
        });
      } catch {
        // ignore
      }
    };

    void sendOnce();
    const timer = setInterval(() => {
      void sendOnce();
    }, TYPING_ACTION_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();

    return {
      stop: () => clearInterval(timer),
    };
  }

  /**
   * 发送 step 文本到 chat。
   *
   * 关键点（中文）
   * - step 必须在当前回调阶段真正送达，不能依赖 run 结束后的 final 兜底。
   * - 先尝试 direct 路径，保留 frontmatter / reaction 等语义。
   * - 若 direct 未送达，则立刻回退到普通 channel 文本发送。
   */
  private async dispatchAssistantStepMessage(params: {
    session_id: string;
    text: string;
    message_id?: string;
  }): Promise<boolean> {
    const stepText = String(params.text || "").trim();
    if (!stepText) return false;

    const dispatchedDirectly = await dispatchAssistantTextDirect({
      logger: this.logger,
      context: this.context,
      session_id: params.session_id,
      assistantText: stepText,
      phase: "step",
    });
    if (dispatchedDirectly) {
      return true;
    }

    return await dispatchTextToChannel({
      logger: this.logger,
      context: this.context,
      session_id: params.session_id,
      text: stepText,
      message_id: params.message_id,
      phase: "step",
    });
  }

  private async processOne(laneKey: string, first: ChatQueueItem): Promise<void> {
    const lane = this.getOrCreateLane(laneKey);
    if (first.kind === "control") {
      this.handleControl(first);
      return;
    }

    if (first.kind === "audit") {
      return;
    }

    const serviceContext = this.requireContext(first.session_id);
    this.ensureLaneSessionSubscription(lane, first.session_id);

    let clearRequested = false;
    const initialBurstItems = await collectInitialBurstItems({
      laneKey,
      first,
      config: this.config,
      queueStore: this.queueStore,
    });
    for (const item of initialBurstItems) {
      if (item.kind === "control") {
        if (item.control?.type === "clear") clearRequested = true;
        continue;
      }
      if (item.kind === "exec") {
        await this.submitExecItem({
          lane,
          item,
          serviceContext,
        });
      }
    }

    if (clearRequested) {
      this.queueStore.clear(first.session_id);
    }
  }

  private ensureLaneSessionSubscription(
    lane: LaneState,
    session_id: string,
  ): void {
    if (lane.unsubscribeSessionEvents) return;
    const session = this.requireContext(session_id);
    lane.unsubscribeSessionEvents = session.subscribe((event) => {
      void this.handleLaneSessionEvent(lane, event);
    });
  }

  private async handleLaneSessionEvent(
    lane: LaneState,
    event: SessionMutation,
  ): Promise<void> {
    const turn_id = String("turn_id" in event ? event.turn_id || "" : "").trim();
    if (!turn_id) return;
    const observation = lane.turnObservers.get(turn_id);
    if (!observation) return;
    if (event.variant === "delta" && event.type === "text") {
      lane.assistantTextByMessageId.set(
        event.message_id,
        `${lane.assistantTextByMessageId.get(event.message_id) || ""}${event.delta}`,
      );
      return;
    }
    if (
      event.variant !== "message" ||
      event.type !== "assistant" ||
      event.message.status === "streaming"
    ) return;
    const segment_text = String(
      lane.assistantTextByMessageId.get(event.message_id) || "",
    ).trim();
    lane.assistantTextByMessageId.delete(event.message_id);
    if (!segment_text || event.message.status !== "completed") return;

    try {
      await this.dispatchAssistantStepMessage({
        session_id: observation.session_id,
        text: segment_text,
        message_id: observation.message_id,
      });
    } catch (error) {
      this.logger.warn("ChatQueueWorker assistant step dispatch failed", {
        session_id: observation.session_id,
        error: String(error),
      });
    }
  }

  private async submitExecItem(params: {
    lane: LaneState;
    item: ChatQueueItem;
    serviceContext: ReturnType<ChatQueueWorker["requireContext"]>;
  }): Promise<void> {
    const item = params.item;
    try {
      const turn = await params.serviceContext.prompt({
        query: item.text,
      });
      if (params.lane.turnObservers.has(turn.id)) {
        return;
      }
      const observation: TurnObservation = {
        turn_id: turn.id,
        session_id: item.session_id,
        message_id: item.message_id,
        typing: this.startTypingHeartbeat(item),
      };
      params.lane.turnObservers.set(turn.id, observation);
      void turn.finished
        .then(async (result) => {
          await this.handleObservedTurnFinish(observation, result);
        })
        .finally(() => {
          observation.typing.stop();
          params.lane.turnObservers.delete(turn.id);
          if (params.lane.turnObservers.size === 0) {
            params.lane.assistantTextByMessageId.clear();
          }
          if (
            params.lane.turnObservers.size === 0 &&
            this.queueStore.getLaneSize(params.lane.key) === 0 &&
            params.lane.unsubscribeSessionEvents
          ) {
            params.lane.unsubscribeSessionEvents();
            params.lane.unsubscribeSessionEvents = undefined;
          }
        });
    } catch (error) {
      const channelErrorText = buildChannelErrorText(error);
      this.logger.error("ChatQueueWorker prompt submit failed", {
        session_id: item.session_id,
        error: String(error),
      });
      await dispatchTextToChannel({
        logger: this.logger,
        context: this.context,
        session_id: item.session_id,
        text: channelErrorText,
        message_id: item.message_id,
        phase: "error",
      });
    }
  }

  private async handleObservedTurnFinish(
    observation: TurnObservation,
    result: AgentSessionTurnResult,
  ): Promise<void> {
    if (String(result.error || "").trim().toLowerCase() === "cancelled") {
      return;
    }

    if (!result.success) {
      const resultErrorText =
        result.text ||
        result.error ||
        "Execution failed";
      const channelErrorText = buildChannelErrorText(resultErrorText);
      this.logger.error("ChatQueueWorker turn finished with failure", {
        session_id: observation.session_id,
        error: result.error || resultErrorText,
      });
      await dispatchTextToChannel({
        logger: this.logger,
        context: this.context,
        session_id: observation.session_id,
        text: channelErrorText,
        message_id: observation.message_id,
        phase: "error",
      });
      return;
    }
  }

  /**
   * 读取 session 端口。
   *
   * 关键点（中文）
   * - 在使用点显式校验，避免隐藏依赖来源。
   */
  private requireContext(session_id: string) {
    return this.context.sessions.runtime(session_id);
  }
}

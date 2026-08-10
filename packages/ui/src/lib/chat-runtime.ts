/** Chat runtime：把 Session JSONL、发送队列和宿主执行能力连接到 ChatPanel。 */
import { session_jsonl_to_chat_messages, session_message_to_chat_message } from "./session-message";
import type { DowncityChatApprovalMode, DowncityChatMessage, DowncityChatModelOption, DowncityChatStatus, DowncityChatSubmitInput } from "../types/chat";
import type { DowncityChatRuntimeListener, DowncityChatRuntimeOptions, DowncityChatRuntimeSnapshot } from "../types/chat-runtime";

function create_id(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

/** 可被 React、Vue 或原生宿主订阅的 Chat 状态容器。 */
export class DowncityChatRuntime {
  private snapshot: DowncityChatRuntimeSnapshot;
  private readonly listeners = new Set<DowncityChatRuntimeListener>();
  private readonly options: DowncityChatRuntimeOptions;
  private queued_inputs: DowncityChatSubmitInput[] = [];

  constructor(options: DowncityChatRuntimeOptions = {}) {
    this.options = options;
    this.snapshot = {
      messages: options.initial_jsonl ? session_jsonl_to_chat_messages(options.initial_jsonl) : [...(options.initial_messages ?? [])],
      status: "ready",
      model_options: options.model_options ?? [{ id: "default", label: "Default model" }],
      model_id: options.model_id ?? options.model_options?.[0]?.id ?? "default",
      approval_mode: options.approval_mode ?? "ask",
    };
  }

  /** 返回当前快照。 */
  get_snapshot(): DowncityChatRuntimeSnapshot { return this.snapshot; }
  /** 订阅状态变化。 */
  subscribe(listener: DowncityChatRuntimeListener): () => void { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
  /** 追加或替换 JSONL 中的 canonical message。 */
  append_jsonl(jsonl: string): void {
    const next_messages = session_jsonl_to_chat_messages(jsonl);
    const by_id = new Map(this.snapshot.messages.map((message) => [message.id, message]));
    for (const message of next_messages) by_id.set(message.id, message);
    this.update({ messages: [...by_id.values()].sort((left, right) => Number(left.metadata?.sequence ?? 0) - Number(right.metadata?.sequence ?? 0)) });
  }
  /** 追加已经解析的 Session message。 */
  append_message(record: Record<string, unknown>): void { this.append_jsonl(JSON.stringify(record)); }
  /** 提交输入；streaming 时进入队列。 */
  async submit(input: DowncityChatSubmitInput, mode: "send" | "queue" = "send"): Promise<void> {
    if (!input.text.trim() && input.attachments.length === 0) return;
    if (mode === "queue" || this.snapshot.status === "streaming" || this.snapshot.status === "submitted" || this.snapshot.status === "building-context") { this.queued_inputs = [...this.queued_inputs, input]; return; }
    const message_id = create_id("user");
    this.update({ status: "submitted", messages: [...this.snapshot.messages, { id: message_id, role: "user", parts: [{ id: `${message_id}-text`, type: "text", text: input.text, state: "done" }], attachments: input.attachments }] });
    await this.options.submit_message?.(input, "send");
  }
  /** 停止当前生成并恢复可输入状态。 */
  async stop(): Promise<void> { await this.options.stop_generation?.(); this.update({ status: "ready" }); }
  /** 响应一个 Session interaction。 */
  async respond_interaction(interaction_id: string, response: unknown): Promise<void> { await this.options.respond_interaction?.(interaction_id, response); }
  /** 切换运行状态，供 Session 事件桥接。 */
  set_status(status: DowncityChatStatus): void { this.update({ status }); }
  /** 修改模型。 */
  set_model(model_id: string): void { this.update({ model_id }); }
  /** 修改 approval 模式。 */
  set_approval_mode(approval_mode: DowncityChatApprovalMode): void { this.update({ approval_mode }); }
  /** 取出下一条队列输入。 */
  dequeue(): DowncityChatSubmitInput | undefined { const [next, ...rest] = this.queued_inputs; this.queued_inputs = rest; return next; }
  private update(partial: Partial<DowncityChatRuntimeSnapshot>): void { this.snapshot = { ...this.snapshot, ...partial }; for (const listener of this.listeners) listener(this.snapshot); }
}

/** 创建一个独立的 Chat runtime。 */
export function create_chat_runtime(options: DowncityChatRuntimeOptions = {}): DowncityChatRuntime { return new DowncityChatRuntime(options); }

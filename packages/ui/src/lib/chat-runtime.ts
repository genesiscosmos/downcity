/** Chat runtime：把 Session JSONL、发送队列和宿主执行能力连接到 ChatPanel。 */
import { session_jsonl_to_chat_messages } from "./session-message";
import type { DowncityChatApprovalMode, DowncityChatMessage, DowncityChatModelOption, DowncityChatStatus, DowncityChatSubmitInput, DowncityChatSubmitMode } from "../types/chat";
import type { DowncityChatRuntimeListener, DowncityChatRuntimeOptions, DowncityChatRuntimeSnapshot } from "../types/chat-runtime";

function create_id(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

/** 可被 React、Vue 或原生宿主订阅的 Chat 状态容器。 */
export class DowncityChatRuntime {
  private snapshot: DowncityChatRuntimeSnapshot;
  private readonly listeners = new Set<DowncityChatRuntimeListener>();
  private readonly options: DowncityChatRuntimeOptions;
  private queued_inputs: Array<{ id: string; input: DowncityChatSubmitInput; sending?: boolean }> = [];

  private closed = false;
  private draining = false;

  constructor(options: DowncityChatRuntimeOptions = {}) {
    this.options = options;
    this.snapshot = {
      session_id: options.session_id,
      messages: options.initial_jsonl ? session_jsonl_to_chat_messages(options.initial_jsonl) : [...(options.initial_messages ?? [])],
      status: "ready",
      model_options: options.model_options ?? [{ id: "default", label: "Default model" }],
      model_id: options.model_id ?? options.model_options?.[0]?.id ?? "default",
      approval_mode: options.approval_mode ?? "ask",
      queued_inputs: [],
      queue_paused: false,
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
    for (const message of next_messages) {
      const current = by_id.get(message.id);
      if (!current || Number(message.metadata?.revision ?? 0) >= Number(current.metadata?.revision ?? 0)) by_id.set(message.id, message);
    }
    this.update({ messages: [...by_id.values()].sort((left, right) => Number(left.metadata?.sequence ?? 0) - Number(right.metadata?.sequence ?? 0)) });
  }
  /** 追加已经解析的 Session message。 */
  append_message(record: Record<string, unknown>): void { this.append_jsonl(JSON.stringify(record)); }
  /** 提交输入；常规发送在运行中进入队列，steer 始终绕过队列即时提交。 */
  async submit(input: DowncityChatSubmitInput, mode: DowncityChatSubmitMode = "send"): Promise<void> {
    if (this.closed) throw new Error("Chat runtime is closed");
    if (!input.text.trim() && input.attachments.length === 0 && !input.parts?.length) return;
    const is_busy = this.snapshot.status === "streaming" || this.snapshot.status === "submitted" || this.snapshot.status === "building-context";
    if (mode !== "steer" && (mode === "queue" || is_busy || this.queued_inputs.length > 0 || this.snapshot.queue_paused || Boolean(this.snapshot.editing_queue_id))) {
      if (mode === "queue") this.update({ queue_paused: true });
      this.queued_inputs = [...this.queued_inputs, { id: create_id("queue"), input }];
      this.sync_queued_inputs();
      return;
    }
    // 用户消息由 Session 持久化后统一读取，runtime 不再创建第二份 optimistic 消息。
    if (!is_busy) this.update({ status: "submitted" });
    try {
      if (!this.options.submit_message) throw new Error("No Session connected");
      await this.options.submit_message(input, mode === "steer" ? "steer" : "send");
    } catch (error) { this.update({ status: "error", error: String(error) }); throw error; }
  }
  /** 请求宿主停止当前生成；最终状态由 Session 事件或快照决定。 */
  async stop(): Promise<void> { if (!this.options.stop_generation) throw new Error("No stop capability connected"); await this.options.stop_generation(); }
  /** 响应一个 Session interaction。 */
  async respond_interaction(interaction_id: string, response: unknown): Promise<void> { if (!this.options.respond_interaction) throw new Error("No interaction responder connected"); await this.options.respond_interaction(interaction_id, response); }
  /** 切换运行状态，供 Session 事件桥接。 */
  set_status(status: DowncityChatStatus): void { this.update({ status }); }
  /** 用 Session 的权威快照替换消息，包括历史截断。 */
  replace_messages(messages: DowncityChatMessage[]): void { this.update({ messages }); }
  /** 更新连接失败或当前模型可重试位置。 */
  set_connection_state(error?: string, retry_message_id?: string): void { this.update({ error, retry_message_id }); }
  /** 只允许重试当前快照公开的有效错误锚点。 */
  async retry(message_id: string): Promise<void> {
    if (this.snapshot.retry_message_id !== message_id || !this.options.retry_message) throw new Error("This message cannot be retried");
    await this.options.retry_message(message_id);
  }
  /** 修改模型。 */
  set_model(model_id: string): void { this.update({ model_id }); }
  /** 修改 approval 模式。 */
  set_approval_mode(approval_mode: DowncityChatApprovalMode): void { this.update({ approval_mode }); }
  /** 取出下一条队列输入。 */
  dequeue(): DowncityChatSubmitInput | undefined {
    if (this.snapshot.queue_paused || this.snapshot.editing_queue_id || this.queued_inputs[0]?.sending) return undefined;
    const [next, ...rest] = this.queued_inputs;
    this.queued_inputs = rest;
    this.sync_queued_inputs();
    return next?.input;
  }
  /** 发送结果未知或失败时恢复队首，等待用户处理，不自动重发。 */
  restore_queued_input(input: DowncityChatSubmitInput): void {
    this.queued_inputs = [{ id: create_id("queue"), input }, ...this.queued_inputs];
    this.sync_queued_inputs();
  }
  /** 删除一条尚未执行的队列输入。 */
  remove_queued_input(input_id: string): void {
    if (this.snapshot.editing_queue_id || this.queued_inputs.find(item => item.id === input_id)?.sending) return;
    this.queued_inputs = this.queued_inputs.filter((item) => item.id !== input_id);
    this.sync_queued_inputs();
  }
  /** 调整一条队列输入的相对顺序。 */
  move_queued_input(input_id: string, direction: "up" | "down"): void {
    if (this.snapshot.editing_queue_id || this.queued_inputs.some(item => item.sending)) return;
    const current_index = this.queued_inputs.findIndex((item) => item.id === input_id);
    const next_index = direction === "up" ? current_index - 1 : current_index + 1;
    if (current_index < 0 || next_index < 0 || next_index >= this.queued_inputs.length) return;
    const next_inputs = [...this.queued_inputs];
    [next_inputs[current_index], next_inputs[next_index]] = [next_inputs[next_index], next_inputs[current_index]];
    this.queued_inputs = next_inputs;
    this.sync_queued_inputs();
  }
  /** 暂停自动调度；恢复时按现有顺序继续，不改变 Agent 运行态。 */
  set_queue_paused(paused: boolean): void { this.update({ queue_paused: paused }); }
  /** 置顶尚未提交项；正在编辑或提交时保持队列不动。 */
  pin_queued_input(input_id: string): void {
    if (this.snapshot.editing_queue_id || this.queued_inputs.some(item => item.sending)) return;
    const item = this.queued_inputs.find(item => item.id === input_id);
    if (!item) return;
    this.queued_inputs = [item, ...this.queued_inputs.filter(entry => entry !== item)];
    this.sync_queued_inputs();
  }
  /** 编辑期间保留队列项和完整文档，自动调度暂时锁定。 */
  edit_queued_input(input_id: string): DowncityChatSubmitInput | undefined {
    if (this.snapshot.editing_queue_id || this.queued_inputs.some(item => item.sending)) return;
    const item = this.queued_inputs.find(item => item.id === input_id);
    if (!item) return;
    this.update({ editing_queue_id: input_id });
    return item.input;
  }
  /** 保存已编辑的完整输入；取消时不传 input，原条目保持原样。 */
  finish_queue_edit(input?: DowncityChatSubmitInput): void {
    const item = this.queued_inputs.find(item => item.id === this.snapshot.editing_queue_id);
    if (item && input) item.input = input;
    this.update({ editing_queue_id: undefined });
    this.sync_queued_inputs();
  }
  /** 显式发送指定队列项；失败或结果未知时保留原身份并暂停，等待用户处理。 */
  async send_queued_input(input_id: string): Promise<void> {
    if (this.closed || this.snapshot.editing_queue_id || this.queued_inputs.some(item => item.sending)) return;
    const item = this.queued_inputs.find(item => item.id === input_id);
    if (!item) return;
    item.sending = true;
    this.sync_queued_inputs();
    try {
      await this.submit(item.input, "steer");
      this.queued_inputs = this.queued_inputs.filter(entry => entry !== item);
    } catch (error) {
      this.update({ queue_paused: true });
      throw error;
    } finally {
      item.sending = false;
      this.sync_queued_inputs();
    }
  }
  /** 连接释放后取消尚未开始的调度；不停止或销毁服务端 Session。 */
  close(): void { this.closed = true; this.listeners.clear(); }
  /** 原连接允许已释放资源的模型失败继续下一条；实际连接/提交错误始终阻止派发。 */
  private can_drain_queue(): boolean {
    return this.snapshot.status === "ready" || this.snapshot.status === "error" && Boolean(this.snapshot.retry_message_id) && !this.snapshot.error;
  }
  /** 唯一自动队列调度点；运行中、编辑中、暂停或错误均不提交下一条。 */
  private async drain_queue(): Promise<void> {
    if (this.closed || this.draining || !this.can_drain_queue() || this.snapshot.queue_paused || this.snapshot.editing_queue_id) return;
    const next = this.queued_inputs[0];
    if (!next || next.sending) return;
    this.draining = true;
    try { await this.send_queued_input(next.id); }
    catch { /* submit 保存失败状态；不自动重发未知结果。 */ }
    finally { this.draining = false; }
    if (!this.closed && this.can_drain_queue() && !this.snapshot.queue_paused && this.queued_inputs.length) queueMicrotask(() => { void this.drain_queue(); });
  }
  /** 将内部队列投影到只读快照，不丢失原位引用与附件。 */
  private sync_queued_inputs(): void {
    this.update({ queued_inputs: this.queued_inputs.map(item => ({ id: item.id, text: item.input.text, input: item.input, sending: Boolean(item.sending) })) });
  }
  private update(partial: Partial<DowncityChatRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener(this.snapshot);
    if (!this.closed && this.can_drain_queue() && this.queued_inputs.length && !this.snapshot.queue_paused && !this.snapshot.editing_queue_id) queueMicrotask(() => { void this.drain_queue(); });
  }
}

/** 创建一个独立的 Chat runtime。 */
export function create_chat_runtime(options: DowncityChatRuntimeOptions = {}): DowncityChatRuntime { return new DowncityChatRuntime(options); }
